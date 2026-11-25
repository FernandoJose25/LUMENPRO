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
    discover_artnet, ArtNetOutput, DmxEngine, DmxOutput, DmxOutputError, DmxUniverse, EngineState,
    EnttecUsbProOutput, MockOutput, OpenDmxOutput, SacnOutput,
};
use lumenpro_show::{Message, Session, Show};
pub use ipc::Client;
use remote::{Remote, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const TICK: Duration = Duration::from_millis(20);
const MAX_WAIT: Duration = Duration::from_secs(2);
/// Con la salida por apagarse, lo que se deja salir el Blackout para que las
/// luces no queden encendidas: muchas se quedan con el último valor.
const FAREWELL: Duration = Duration::from_millis(250);
const DISCOVERY: Duration = Duration::from_millis(2500);

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

/// Por dónde sale un universo del show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputConfig {
    id: String,
    /// open_dmx, enttec, artnet, sacn o mock.
    adapter: String,
    /// Universo del show.
    universe: i32,
    fps: u32,
    /// Los de USB: "COM5".
    #[serde(default)]
    port: String,
    /// Los de red: IP del nodo, o vacío para toda la red.
    #[serde(default)]
    host: String,
    /// Los de red: número de universo del otro lado.
    #[serde(default)]
    target: u16,
}

impl OutputConfig {
    fn open(&self) -> Result<Box<dyn DmxOutput>, DmxOutputError> {
        Ok(match self.adapter.as_str() {
            // Cable FTDI barato: el timing lo genera la PC.
            "open_dmx" => Box::new(OpenDmxOutput::open(&self.port)?),
            // Enttec (o compatible): el timing lo genera el adaptador.
            "enttec" => Box::new(EnttecUsbProOutput::open(&self.port)?),
            "artnet" => Box::new(ArtNetOutput::open(&self.host, self.target)?),
            "sacn" => Box::new(SacnOutput::open(&self.host, self.target)?),
            _ => Box::new(MockOutput::new()),
        })
    }

    /// Cómo se llama mientras no se pueda abrir.
    fn name(&self) -> String {
        match self.adapter.as_str() {
            "artnet" => format!("Art-Net {}", self.target),
            "sacn" => format!("sACN {}", self.target),
            _ => self.port.clone(),
        }
    }
}

struct Output {
    config: OutputConfig,
    dmx: DmxEngine,
}

fn state_name(state: EngineState) -> &'static str {
    match state {
        EngineState::Stopped => "stopped",
        EngineState::Running => "running",
        EngineState::Reconnecting => "reconnecting",
    }
}

/// Lo que se guarda en disco para retomar si el motor se cae.
#[derive(Serialize, Deserialize)]
struct Saved {
    session: Session,
    outputs: Vec<OutputConfig>,
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
    /// Los que salen por algún lado.
    universes: Mutex<BTreeMap<i32, DmxUniverse>>,
    outputs: Mutex<Vec<Arc<Output>>>,
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
    /// Si no se puede abrir es un error y no se agrega.
    AddOutput { output: OutputConfig },
    RemoveOutput { id: String },
    /// Las de la última vez: las que no se puedan abrir quedan reintentando.
    SetOutputs { outputs: Vec<OutputConfig> },
    DiscoverArtnet,
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

impl Engine {
    fn new(dir: &Path) -> Arc<Self> {
        let clock = Clock::new();
        let now = Instant::now();
        let engine = Arc::new(Self {
            boot_id: format!("{:x}-{:x}", clock.base as u64, std::process::id()),
            dir: dir.into(),
            clock,
            show: Mutex::new(Show::new()),
            changed: Condvar::new(),
            ack: Mutex::new(0),
            universes: Mutex::new(BTreeMap::new()),
            outputs: Mutex::new(Vec::new()),
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
                    for (number, universe) in engine.universes.lock().unwrap().iter() {
                        universe.set_block(1, &show.frame(*number));
                    }
                }
            }
            thread::sleep(TICK.saturating_sub(started.elapsed()));
        });
    }

    /// Vacío si no hay salidas; con varias, la peor.
    fn dmx_state(&self) -> &'static str {
        let outputs = self.outputs.lock().unwrap();
        if outputs.is_empty() {
            return "stopped";
        }
        let worst = outputs.iter().map(|o| o.dmx.status().state).find(|s| *s != EngineState::Running);
        state_name(worst.unwrap_or(EngineState::Running))
    }

    fn dmx_status(&self) -> Value {
        let state = self.dmx_state();
        let outputs = self.outputs.lock().unwrap();
        let outputs: Vec<Value> = outputs
            .iter()
            .map(|o| {
                let status = o.dmx.status();
                json!({
                    "config": o.config,
                    "state": state_name(status.state),
                    "name": status.output,
                    "lastError": status.last_error,
                    "fps": status.fps,
                    "worstGapMs": status.worst_gap.as_millis() as u64,
                })
            })
            .collect();
        json!({ "state": state, "outputs": outputs })
    }

    /// El buffer de un universo, ya con lo que el show tiene ahora.
    fn universe(&self, number: i32) -> DmxUniverse {
        let frame = self.show.lock().unwrap().frame(number);
        let universe = self.universes.lock().unwrap().entry(number).or_default().clone();
        universe.set_block(1, &frame);
        universe
    }

    /// Puede tardar (un puerto USB lento): no retiene nada mientras abre.
    fn add_output(&self, config: OutputConfig, retry: bool) -> Result<(), String> {
        self.remove_output(&config.id);
        let mut dmx = DmxEngine::new(self.universe(config.universe));
        let (opener, fps) = (config.clone(), config.fps);
        if retry {
            dmx.start_retrying(config.name(), move || opener.open(), fps);
        } else {
            dmx.start(move || opener.open(), fps).map_err(|e| e.to_string())?;
        }
        self.outputs.lock().unwrap().push(Arc::new(Output { config, dmx }));
        Ok(())
    }

    fn remove_output(&self, id: &str) {
        let removed: Vec<Arc<Output>> = {
            let mut outputs = self.outputs.lock().unwrap();
            let (gone, kept) = outputs.drain(..).partition(|o| o.config.id == id);
            *outputs = kept;
            gone
        };
        // Cerrar espera al hilo de salida: fuera del lock.
        drop(removed);
        let outputs = self.outputs.lock().unwrap();
        self.universes.lock().unwrap().retain(|n, _| outputs.iter().any(|o| o.config.universe == *n));
    }

    fn output_configs(&self) -> Vec<OutputConfig> {
        self.outputs.lock().unwrap().iter().map(|o| o.config.clone()).collect()
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
        if self.dmx_state() != "stopped" {
            thread::sleep(FAREWELL);
        }
        for config in self.output_configs() {
            self.remove_output(&config.id);
        }
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
            Request::AddOutput { output } => self.add_output(output, false).map(|()| self.dmx_status()),
            Request::RemoveOutput { id } => {
                self.remove_output(&id);
                Ok(self.dmx_status())
            }
            Request::SetOutputs { outputs } => {
                for output in outputs {
                    self.add_output(output, true)?;
                }
                Ok(self.dmx_status())
            }
            Request::DiscoverArtnet => {
                let nodes = discover_artnet(DISCOVERY).map_err(|e| e.to_string())?;
                let nodes: Vec<Value> = nodes
                    .into_iter()
                    .map(|n| {
                        let name = if n.long_name.is_empty() { n.short_name } else { n.long_name };
                        json!({ "ip": n.ip.to_string(), "name": name, "universes": n.universes })
                    })
                    .collect();
                Ok(json!(nodes))
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
        Some(Saved { session, outputs: self.output_configs(), ui_expected })
    }

    fn resume(&self, saved: Saved) -> Result<(), String> {
        self.show.lock().unwrap().restore(saved.session, self.clock.now())?;
        self.ui.lock().unwrap().detached = !saved.ui_expected;
        // El cable puede seguir tomado un instante por el proceso caído: por
        // eso reintentando.
        for output in saved.outputs {
            self.add_output(output, true)?;
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

    /// Sin tiempos fijos: en una PC cargada los hilos tardan en nacer.
    fn eventually(what: &str, ok: impl Fn() -> bool) {
        let limit = Instant::now() + Duration::from_secs(20);
        while !ok() {
            assert!(Instant::now() < limit, "{what}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn changes(what: &str, read: impl Fn() -> u8) {
        let before = read();
        eventually(what, || read() != before);
    }

    fn started(name: &str) -> Arc<Engine> {
        let engine = Engine::new(&temp(name));
        engine.play();
        send(&engine, 1, json!([{ "type": "reset", "doc": doc() }]));
        engine
    }

    fn channel(engine: &Engine, n: u16) -> u8 {
        engine.universes.lock().unwrap()[&1].get_channel(n)
    }

    fn mock(id: &str, universe: i32) -> Value {
        json!({ "cmd": "addOutput", "output": { "id": id, "adapter": "mock", "universe": universe, "fps": 30 } })
    }

    #[test]
    fn orders_reach_the_output() {
        let engine = started("orders");
        ask(&engine, mock("a", 1));
        send(&engine, 2, json!([{ "type": "startMoment", "id": "a" }]));
        eventually("el fade llega", || (channel(&engine, 1), channel(&engine, 2)) == (200, 128));
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

        let (other, (sender, receiver)) = (engine.clone(), std::sync::mpsc::channel());
        let waiting = thread::spawn(move || {
            sender.send(()).unwrap();
            ask(&other, json!({ "cmd": "wait", "since": rev, "timeoutMs": 2000 }))
        });
        receiver.recv().unwrap();
        thread::sleep(Duration::from_millis(50));
        let at = Instant::now();
        send(&engine, 2, json!([{ "type": "blackout", "on": true }]));
        let reply = waiting.join().unwrap();
        assert!(at.elapsed() < Duration::from_millis(1500));
        assert_eq!(reply["changes"]["playback"]["blackoutActive"], true);
        assert_eq!(reply["ack"], 2);
    }

    #[test]
    fn the_phone_works_without_any_window() {
        let engine = started("phone");
        ask(&engine, mock("a", 1));
        engine.show.lock().unwrap().remote(&json!({ "type": "moment", "id": "b" }), engine.clock.now());
        eventually("arranca", || engine.show.lock().unwrap().session().playback.running_effect_ids == ["fx"]);
        changes("el effect sigue corriendo sin ventana", || channel(&engine, 1));
    }

    #[test]
    fn a_crash_resumes_the_show_and_the_output() {
        let engine = started("crash");
        ask(&engine, mock("a", 1));
        send(&engine, 2, json!([{ "type": "startMoment", "id": "b" }, { "type": "master", "value": 80 }]));
        eventually("arranca", || engine.show.lock().unwrap().session().playback.running_effect_ids == ["fx"]);
        let saved = serde_json::to_string(&engine.save().unwrap()).unwrap();

        let again = Engine::new(&temp("crash2"));
        again.play();
        again.resume(serde_json::from_str(&saved).unwrap()).unwrap();
        assert_eq!(again.dmx_state(), "running");
        assert_eq!(again.show.lock().unwrap().session().playback.master, 80.0);
        changes("sigue el effect", || channel(&again, 1));
    }

    #[test]
    fn shutting_down_turns_the_lights_off_without_moving_the_heads() {
        let engine = started("bye");
        ask(&engine, mock("a", 1));
        send(&engine, 2, json!([{ "type": "startMoment", "id": "a" }]));
        eventually("enciende", || channel(&engine, 1) == 200);
        assert!(engine.is_live());
        let universe = engine.universe(1);
        engine.farewell();
        assert_eq!((universe.get_channel(1), universe.get_channel(2)), (0, 128));
        assert_eq!(engine.dmx_state(), "stopped");
    }

    fn states(status: &Value) -> Vec<(String, String)> {
        let outputs = status["outputs"].as_array().unwrap();
        outputs
            .iter()
            .map(|o| (o["config"]["id"].as_str().unwrap().into(), o["state"].as_str().unwrap().into()))
            .collect()
    }

    #[test]
    fn several_universes_go_out_at_once_each_with_its_own_lights() {
        let engine = started("universes");
        let mut two = doc();
        two["instances"].as_array_mut().unwrap().push(
            json!({ "id": "p2", "definitionId": "par", "universe": 2, "address": 10, "group": "g" }),
        );
        send(&engine, 2, json!([{ "type": "doc", "doc": two }]));
        ask(&engine, mock("a", 1));
        ask(&engine, mock("b", 2));
        ask(&engine, mock("c", 2)); // el mismo universo por dos lados
        send(&engine, 3, json!([{ "type": "values", "values": { "p1": { "dim": 11 }, "p2": { "dim": 22 } } }]));
        let at = |u: i32, channel| engine.universes.lock().unwrap()[&u].get_channel(channel);
        eventually("salen los dos", || (at(1, 1), at(2, 10)) == (11, 22));
        let universes = engine.universes.lock().unwrap();
        assert_eq!(universes.keys().copied().collect::<Vec<_>>(), [1, 2]);
        assert_eq!((universes[&1].get_channel(1), universes[&1].get_channel(10)), (11, 0));
        assert_eq!((universes[&2].get_channel(1), universes[&2].get_channel(10)), (0, 22));
    }

    #[test]
    fn a_new_output_starts_with_what_is_on_not_dark() {
        let engine = started("new");
        send(&engine, 2, json!([{ "type": "values", "values": { "p1": { "dim": 99 } } }]));
        ask(&engine, mock("a", 1));
        assert_eq!(channel(&engine, 1), 99);
    }

    #[test]
    fn outputs_are_removed_one_by_one_and_replaced_by_id() {
        let engine = started("remove");
        ask(&engine, mock("a", 1));
        ask(&engine, mock("b", 2));
        let status = ask(&engine, mock("a", 3)); // cambiar de universo
        assert_eq!(states(&status).len(), 2);
        let status = ask(&engine, json!({ "cmd": "removeOutput", "id": "a" }));
        assert_eq!(states(&status), [("b".into(), "running".into())]);
        assert_eq!(engine.universes.lock().unwrap().keys().copied().collect::<Vec<_>>(), [2]);
        let status = ask(&engine, json!({ "cmd": "removeOutput", "id": "b" }));
        assert_eq!(status["state"], "stopped");
    }

    #[test]
    fn an_output_that_fails_is_not_added_but_a_saved_one_keeps_trying() {
        let engine = started("fails");
        let bad = json!({ "id": "x", "adapter": "open_dmx", "universe": 1, "fps": 30, "port": "COM_NO_EXISTE" });
        let request = json!({ "cmd": "addOutput", "output": bad });
        assert!(engine.handle(serde_json::from_value(request).unwrap()).is_err());
        assert_eq!(engine.dmx_state(), "stopped");

        ask(&engine, mock("ok", 1));
        let status = ask(&engine, json!({ "cmd": "setOutputs", "outputs": [bad] }));
        assert_eq!(status["state"], "reconnecting", "con varias, se muestra la peor");
        assert_eq!(status["outputs"][1]["name"], "COM_NO_EXISTE");
        assert!(status["outputs"][1]["lastError"].is_string());
        assert_eq!(states(&status)[0].1, "running", "y la otra sigue");
    }

    #[test]
    fn the_network_receives_exactly_what_the_engine_shows() {
        let engine = started("network");
        let socket = std::net::UdpSocket::bind("127.0.0.1:6454").expect("otro programa usa el puerto Art-Net");
        ask(&engine, json!({ "cmd": "addOutput", "output":
            { "id": "n", "adapter": "artnet", "universe": 1, "fps": 40, "host": "127.0.0.1", "target": 9 } }));
        send(&engine, 2, json!([{ "type": "values", "values": { "p1": { "dim": 123, "pan": 45 } } }]));
        socket.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
        let mut packet = [0u8; 600];
        loop {
            let len = socket.recv_from(&mut packet).unwrap().0;
            assert_eq!((len, packet[14]), (530, 9));
            if (packet[18], packet[19]) == (123, 45) {
                break;
            }
        }
        let frame = ask(&engine, json!({ "cmd": "frame", "universe": 1 }));
        assert_eq!(json!(packet[18..530].to_vec()), frame);
    }

    #[test]
    fn a_reopened_window_gets_the_show_back() {
        let engine = started("reopen");
        send(&engine, 2, json!([{ "type": "startMoment", "id": "b" }]));
        eventually("arranca", || engine.show.lock().unwrap().session().playback.running_effect_ids == ["fx"]);
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
