//! El motor del show en su propio proceso: lleva los momentos, saca el DMX y
//! atiende al celular. La ventana es solo un control más: si se traba o se
//! cierra, la señal sigue (y este proceso la vuelve a abrir).
//!
//! La ventana le habla por TCP en 127.0.0.1 (ver `link.rs`): una línea JSON
//! por pedido y una por respuesta.

mod ipc;
pub mod process;
mod remote;
mod supervisor;

use lumenpro_dmx::{
    DmxEngine, DmxOutput, DmxOutputError, DmxUniverse, EngineState, EnttecUsbProOutput, MockOutput, OpenDmxOutput,
};
use lumenpro_show::{Message, Session, Show};
pub use ipc::Client;
use remote::{Remote, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TICK: Duration = Duration::from_millis(20);
const MAX_WAIT: Duration = Duration::from_secs(2);
/// Con la salida por apagarse, lo que se deja salir el Blackout para que las
/// luces no queden encendidas: muchas se quedan con el último valor.
const FAREWELL: Duration = Duration::from_millis(250);

/// Reloj en milisegundos con la base de `Date.now()`, pero que nunca salta
/// hacia atrás aunque Windows corrija la hora a mitad del evento.
#[derive(Clone, Copy)]
struct Clock {
    base: f64,
    start: Instant,
}

impl Clock {
    fn new() -> Self {
        let base = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0);
        Self { base, start: Instant::now() }
    }

    fn now(&self) -> f64 {
        (self.base + self.start.elapsed().as_secs_f64() * 1000.0).floor()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Output {
    adapter: String,
    port: String,
    fps: u32,
}

/// Lo que se guarda en disco para retomar si el motor se cae.
#[derive(Serialize, Deserialize)]
struct Saved {
    session: Session,
    output: Option<Output>,
    ui_expected: bool,
}

/// La ventana, vista desde el motor.
struct Ui {
    pid: Option<u32>,
    /// Conexiones abiertas de ese proceso: en 0, se cerró o se cayó.
    connections: usize,
    last_seen: Instant,
    /// Se cerró a propósito dejando las luces encendidas: no hay que reabrirla.
    detached: bool,
    /// Alguien abrió el programa otra vez: que la ventana pase al frente.
    focus: bool,
    listening_until: Instant,
}

struct Engine {
    boot_id: String,
    dir: PathBuf,
    clock: Clock,
    show: Mutex<Show>,
    changed: Condvar,
    /// Último lote de órdenes aplicado (ver `Request::Send`).
    ack: Mutex<u64>,
    universe: DmxUniverse,
    dmx: Mutex<DmxEngine>,
    output: Mutex<Option<Output>>,
    remote: std::sync::OnceLock<Remote>,
    ui: Mutex<Ui>,
}

#[derive(Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Request {
    /// Primera orden de una ventana nueva.
    Attach { pid: u32 },
    /// Órdenes en lote. `seq` repetido = reintento: no se aplica dos veces.
    Send { seq: u64, messages: Vec<Value> },
    /// Espera a que algo cambie después de `since`.
    Wait { since: u64, timeout_ms: u64 },
    Frame { universe: i32 },
    Connect { adapter: String, port: String, fps: u32 },
    Disconnect,
    RemoteStatus,
    RemoteSetEnabled { enabled: bool },
    RemoteNewPin,
    /// ¿Se notaría si se apaga?
    Live,
    /// Otra copia del programa pregunta si ya hay ventana.
    Focus,
    /// La ventana se cierra a propósito.
    Detach { stop: bool },
}

fn open_output(adapter: &str, port: &str) -> Result<Box<dyn DmxOutput>, DmxOutputError> {
    Ok(match adapter {
        // Cable FTDI barato: el timing lo genera la PC.
        "open_dmx" => Box::new(OpenDmxOutput::open(port)?),
        // Enttec (o compatible): el timing lo genera el adaptador.
        "enttec" => Box::new(EnttecUsbProOutput::open(port)?),
        _ => Box::new(MockOutput::new()),
    })
}

impl Engine {
    fn new(dir: &Path) -> Arc<Self> {
        let clock = Clock::new();
        let universe = DmxUniverse::new();
        let now = Instant::now();
        let engine = Arc::new(Self {
            boot_id: format!("{:x}-{:x}", clock.base as u64, std::process::id()),
            dir: dir.into(),
            clock,
            show: Mutex::new(Show::new()),
            changed: Condvar::new(),
            ack: Mutex::new(0),
            dmx: Mutex::new(DmxEngine::new(universe.clone())),
            universe,
            output: Mutex::new(None),
            remote: std::sync::OnceLock::new(),
            ui: Mutex::new(Ui {
                pid: None,
                connections: 0,
                last_seen: now,
                detached: false,
                focus: false,
                listening_until: now,
            }),
        });
        let (for_state, for_command) = (Arc::downgrade(&engine), Arc::downgrade(&engine));
        let source = Source {
            snapshot: Box::new(move || {
                for_state.upgrade().map_or("null".into(), |e| {
                    let dmx = e.dmx_state();
                    let snapshot = e.show.lock().unwrap().phone_snapshot(dmx);
                    snapshot.to_string()
                })
            }),
            command: Box::new(move |command| {
                if let Some(e) = for_command.upgrade() {
                    let now = e.clock.now();
                    e.show.lock().unwrap().remote(&command, now);
                    e.changed.notify_all();
                }
            }),
        };
        let _ = engine.remote.set(Remote::load(dir, source));
        engine
    }

    fn remote(&self) -> &Remote {
        self.remote.get().expect("se crea junto con el motor")
    }

    /// Avanza el show y pone los canales donde los lee el hilo de salida.
    fn play(self: &Arc<Self>) {
        let engine = self.clone();
        let mut sent_rev = u64::MAX;
        thread::spawn(move || loop {
            let started = Instant::now();
            {
                let mut show = engine.show.lock().unwrap();
                show.tick(engine.clock.now());
                if show.rev() != sent_rev {
                    sent_rev = show.rev();
                    engine.changed.notify_all();
                    engine.universe.set_block(1, &show.frame(1));
                }
            }
            thread::sleep(TICK.saturating_sub(started.elapsed()));
        });
    }

    fn dmx_state(&self) -> &'static str {
        match self.dmx.lock().unwrap().status().state {
            EngineState::Stopped => "stopped",
            EngineState::Running => "running",
            EngineState::Reconnecting => "reconnecting",
        }
    }

    fn dmx_status(&self) -> Value {
        let status = self.dmx.lock().unwrap().status();
        json!({
            "state": match status.state {
                EngineState::Stopped => "stopped",
                EngineState::Running => "running",
                EngineState::Reconnecting => "reconnecting",
            },
            "output": status.output,
            "lastError": status.last_error,
            "fps": status.fps,
            "worstGapMs": status.worst_gap.as_millis() as u64,
        })
    }

    fn connect(&self, output: Output) -> Result<(), String> {
        let (adapter, port) = (output.adapter.clone(), output.port.clone());
        self.dmx
            .lock()
            .unwrap()
            .start(move || open_output(&adapter, &port), output.fps)
            .map_err(|e| e.to_string())?;
        *self.output.lock().unwrap() = Some(output);
        Ok(())
    }

    fn disconnect(&self) {
        self.dmx.lock().unwrap().stop();
        *self.output.lock().unwrap() = None;
    }

    fn is_live(&self) -> bool {
        self.dmx_state() != "stopped" || self.show.lock().unwrap().is_playing()
    }

    /// Apaga las luces y suelta los puertos.
    fn farewell(&self) {
        let now = self.clock.now();
        {
            let mut show = self.show.lock().unwrap();
            let _ = show.apply(Message::Blackout { on: true }, now);
        }
        if self.dmx_state() == "running" {
            thread::sleep(FAREWELL);
        }
        self.disconnect();
    }

    fn handle(&self, request: Request) -> Result<Value, String> {
        let now = self.clock.now();
        match request {
            Request::Attach { pid } => {
                let listening = {
                    let mut ui = self.ui.lock().unwrap();
                    ui.pid = Some(pid);
                    ui.last_seen = Instant::now();
                    ui.detached = false;
                    ui.focus = false;
                    Instant::now() < ui.listening_until
                };
                self.remote().apply();
                let show = self.show.lock().unwrap();
                let session = if show.is_empty() { Value::Null } else { json!(show.session()) };
                Ok(json!({ "bootId": self.boot_id, "session": session, "listening": listening }))
            }
            Request::Send { seq, messages } => {
                let mut ack = self.ack.lock().unwrap();
                let mut error = Value::Null;
                if seq != *ack {
                    let mut show = self.show.lock().unwrap();
                    for message in messages {
                        if message["type"] == "audio" {
                            let mut ui = self.ui.lock().unwrap();
                            let hold = if message["audio"].is_null() { Duration::ZERO } else { Duration::from_secs(60) };
                            ui.listening_until = Instant::now() + hold;
                        }
                        let applied = serde_json::from_value::<Message>(message)
                            .map_err(|e| e.to_string())
                            .and_then(|m| show.apply(m, now));
                        if let Err(e) = applied {
                            error = json!(e);
                        }
                    }
                    *ack = seq;
                }
                self.changed.notify_all();
                Ok(json!({ "ack": seq, "error": error }))
            }
            Request::Wait { since, timeout_ms } => {
                self.ui.lock().unwrap().last_seen = Instant::now();
                let timeout = Duration::from_millis(timeout_ms).min(MAX_WAIT);
                let show = self.show.lock().unwrap();
                let (show, _) =
                    self.changed.wait_timeout_while(show, timeout, |s| s.rev() == since).unwrap();
                let changes = if show.rev() == since { Value::Null } else { show.changes(since) };
                drop(show);
                let focus = {
                    let mut ui = self.ui.lock().unwrap();
                    ui.last_seen = Instant::now();
                    std::mem::take(&mut ui.focus)
                };
                Ok(json!({
                    "bootId": self.boot_id,
                    "ack": *self.ack.lock().unwrap(),
                    "changes": changes,
                    "dmx": self.dmx_status(),
                    "focus": focus,
                }))
            }
            Request::Frame { universe } => Ok(json!(self.show.lock().unwrap().frame(universe).as_slice())),
            Request::Connect { adapter, port, fps } => {
                self.connect(Output { adapter, port, fps }).map(|()| self.dmx_status())
            }
            Request::Disconnect => {
                self.disconnect();
                Ok(self.dmx_status())
            }
            Request::RemoteStatus => Ok(json!(self.remote().status())),
            Request::RemoteSetEnabled { enabled } => {
                self.remote().set_enabled(enabled)?;
                Ok(json!(self.remote().status()))
            }
            Request::RemoteNewPin => {
                self.remote().new_pin()?;
                Ok(json!(self.remote().status()))
            }
            Request::Live => Ok(json!(self.is_live())),
            Request::Focus => {
                let mut ui = self.ui.lock().unwrap();
                let alive = ui.connections > 0 && ui.last_seen.elapsed() < supervisor::RESPONSIVE;
                ui.focus = alive;
                self.changed.notify_all();
                Ok(json!(ui.pid.filter(|_| alive)))
            }
            Request::Detach { stop } => {
                {
                    let mut ui = self.ui.lock().unwrap();
                    ui.pid = None;
                    ui.detached = true;
                }
                if stop {
                    self.farewell();
                    supervisor::exit_soon(&self.dir);
                }
                Ok(Value::Null)
            }
        }
    }

    fn save(&self) -> Option<Saved> {
        let show = self.show.lock().unwrap();
        if show.is_empty() {
            return None;
        }
        let session = show.session();
        drop(show);
        let ui_expected = !self.ui.lock().unwrap().detached;
        Some(Saved { session, output: self.output.lock().unwrap().clone(), ui_expected })
    }

    fn resume(&self, saved: Saved) -> Result<(), String> {
        self.show.lock().unwrap().restore(saved.session, self.clock.now())?;
        self.ui.lock().unwrap().detached = !saved.ui_expected;
        if let Some(output) = saved.output {
            // El cable puede seguir tomado un instante por el proceso caído.
            for _ in 0..20 {
                if self.connect(output.clone()).is_ok() {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
        self.remote().apply();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lumenpro-engine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn doc() -> Value {
        json!({
            "definitions": [{ "id": "par", "channels": [
                { "id": "dim", "index": 1, "type": "DIMMER", "dmxMin": 0, "dmxMax": 255, "defaultValue": 0 },
                { "id": "pan", "index": 2, "type": "PAN", "dmxMin": 0, "dmxMax": 255, "defaultValue": 128 },
            ]}],
            "instances": [{ "id": "p1", "definitionId": "par", "universe": 1, "address": 1, "group": "g" }],
            "scenes": [{ "id": "on", "values": { "p1": { "dim": 200 } } }],
            "effects": [{ "id": "fx", "groupId": "g", "channelType": "DIMMER", "waveform": "sawtooth",
                          "speedCpm": 120, "min": 0, "max": 255, "source": "clock", "beatsPerCycle": 1 }],
            "moments": [
                { "id": "a", "name": "Entrada", "sceneId": "on", "effectIds": [], "fadeMs": 100 },
                { "id": "b", "name": "Hora loca", "sceneId": "on", "effectIds": ["fx"], "fadeMs": 0 },
            ],
        })
    }

    fn ask(engine: &Engine, request: Value) -> Value {
        engine.handle(serde_json::from_value(request).unwrap()).unwrap()
    }

    fn send(engine: &Engine, seq: u64, messages: Value) -> Value {
        ask(engine, json!({ "cmd": "send", "seq": seq, "messages": messages }))
    }

    fn started(name: &str) -> Arc<Engine> {
        let engine = Engine::new(&temp(name));
        engine.play();
        send(&engine, 1, json!([{ "type": "reset", "doc": doc() }]));
        engine
    }

    fn channel(engine: &Engine, n: u16) -> u8 {
        engine.universe.get_channel(n)
    }

    #[test]
    fn orders_reach_the_output() {
        let engine = started("orders");
        send(&engine, 2, json!([{ "type": "startMoment", "id": "a" }]));
        thread::sleep(Duration::from_millis(250));
        assert_eq!((channel(&engine, 1), channel(&engine, 2)), (200, 128));
        assert_eq!(ask(&engine, json!({ "cmd": "frame", "universe": 1 }))[0], 200);
    }

    #[test]
    fn a_retried_batch_is_not_applied_twice() {
        let engine = started("retry");
        for _ in 0..2 {
            send(&engine, 2, json!([{ "type": "stepMoment", "direction": 1 }]));
        }
        let session = ask(&engine, json!({ "cmd": "attach", "pid": 1 }));
        assert_eq!(session["session"]["playback"]["activeMomentId"], "a");
    }

    #[test]
    fn one_bad_order_does_not_block_the_rest() {
        let engine = started("bad");
        let reply = send(&engine, 2, json!([{ "type": "nada" }, { "type": "master", "value": 40 }]));
        assert_eq!(reply["ack"], 2);
        assert!(reply["error"].is_string());
        assert_eq!(engine.show.lock().unwrap().session().playback.master, 40.0);
    }

    #[test]
    fn waiting_returns_at_once_when_something_changes_and_empty_if_nothing_does() {
        let engine = started("wait");
        let rev = engine.show.lock().unwrap().rev();
        let quiet = ask(&engine, json!({ "cmd": "wait", "since": rev, "timeoutMs": 60 }));
        assert_eq!(quiet["changes"], Value::Null);

        let other = engine.clone();
        let waiting =
            thread::spawn(move || ask(&other, json!({ "cmd": "wait", "since": rev, "timeoutMs": 2000 })));
        thread::sleep(Duration::from_millis(50));
        let at = Instant::now();
        send(&engine, 2, json!([{ "type": "blackout", "on": true }]));
        let reply = waiting.join().unwrap();
        assert!(at.elapsed() < Duration::from_millis(500));
        assert_eq!(reply["changes"]["playback"]["blackoutActive"], true);
        assert_eq!(reply["ack"], 2);
    }

    #[test]
    fn the_phone_works_without_any_window() {
        let engine = started("phone");
        engine.show.lock().unwrap().remote(&json!({ "type": "moment", "id": "b" }), engine.clock.now());
        thread::sleep(Duration::from_millis(300));
        let a = channel(&engine, 1);
        thread::sleep(Duration::from_millis(100));
        assert_ne!(channel(&engine, 1), a, "el effect sigue corriendo sin ventana");
    }

    #[test]
    fn a_crash_resumes_the_show_and_the_output() {
        let engine = started("crash");
        ask(&engine, json!({ "cmd": "connect", "adapter": "mock", "port": "", "fps": 30 }));
        send(&engine, 2, json!([{ "type": "startMoment", "id": "b" }, { "type": "master", "value": 80 }]));
        thread::sleep(Duration::from_millis(200));
        let saved = serde_json::to_string(&engine.save().unwrap()).unwrap();

        let again = Engine::new(&temp("crash2"));
        again.play();
        again.resume(serde_json::from_str(&saved).unwrap()).unwrap();
        assert_eq!(again.dmx_state(), "running");
        assert_eq!(again.show.lock().unwrap().session().playback.master, 80.0);
        thread::sleep(Duration::from_millis(100));
        let a = channel(&again, 1);
        thread::sleep(Duration::from_millis(100));
        assert_ne!(channel(&again, 1), a);
    }

    #[test]
    fn shutting_down_turns_the_lights_off_without_moving_the_heads() {
        let engine = started("bye");
        ask(&engine, json!({ "cmd": "connect", "adapter": "mock", "port": "", "fps": 30 }));
        send(&engine, 2, json!([{ "type": "startMoment", "id": "a" }]));
        thread::sleep(Duration::from_millis(250));
        assert!(engine.is_live());
        engine.farewell();
        assert_eq!((channel(&engine, 1), channel(&engine, 2)), (0, 128));
        assert_eq!(engine.dmx_state(), "stopped");
    }

    #[test]
    fn a_reopened_window_gets_the_show_back() {
        let engine = started("reopen");
        send(&engine, 2, json!([{ "type": "startMoment", "id": "b" }]));
        thread::sleep(Duration::from_millis(100));
        let reply = ask(&engine, json!({ "cmd": "attach", "pid": 7 }));
        assert_eq!(reply["session"]["doc"], doc());
        assert_eq!(reply["session"]["playback"]["runningEffectIds"], json!(["fx"]));
        assert_eq!(reply["listening"], false);
        send(&engine, 3, json!([{ "type": "audio", "audio": { "levels": { "bass": 0, "mid": 0, "treble": 0 }, "beat": null } }]));
        assert_eq!(ask(&engine, json!({ "cmd": "attach", "pid": 8 }))["listening"], true);
        send(&engine, 4, json!([{ "type": "audio", "audio": null }]));
        assert_eq!(ask(&engine, json!({ "cmd": "attach", "pid": 9 }))["listening"], false);
    }
}
