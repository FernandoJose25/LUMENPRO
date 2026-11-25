//! Vigila la ventana (la reabre si se cae o se traba), guarda la sesión por si
//! se cae el motor, y no deja que la laptop se duerma.

use super::process;
use super::Engine;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const EVERY: Duration = Duration::from_millis(500);
const SAVE_EVERY: Duration = Duration::from_secs(1);
/// La ventana da señales al menos una vez por segundo.
pub const RESPONSIVE: Duration = Duration::from_secs(4);
const HUNG: Duration = Duration::from_secs(15);
/// Entre que se lanza la ventana y saluda.
const STARTUP: Duration = Duration::from_secs(30);
/// Un hueco así entre dos vueltas es que la laptop estuvo suspendida.
const SUSPENDED: Duration = Duration::from_secs(3);
/// Si se cae una y otra vez, insistir no ayuda.
const MAX_REOPENS: usize = 4;
const REOPEN_WINDOW: Duration = Duration::from_secs(120);

pub const SESSION_FILE: &str = "session.json";

/// Qué hacer con la ventana.
#[derive(Debug, PartialEq, Eq)]
enum Action {
    Nothing,
    /// Con el proceso de la anterior, si la hubo: puede haber dejado restos, o
    /// seguir ahí sin responder.
    Open(Option<u32>),
    /// Sin ventana y sin nada encendido, el motor no tiene para qué seguir.
    Exit,
}

struct Watch {
    /// Desde cuándo se espera que una ventana salude.
    opening_since: Option<Instant>,
    reopens: Vec<Instant>,
}

impl Watch {
    fn may_reopen(&mut self, now: Instant) -> bool {
        self.reopens.retain(|at| now.duration_since(*at) < REOPEN_WINDOW);
        self.reopens.len() < MAX_REOPENS
    }

    fn opened(&mut self, now: Instant) {
        self.opening_since = Some(now);
        self.reopens.push(now);
    }

    fn decide(&mut self, engine: &Engine, now: Instant) -> Action {
        let live = engine.is_live();
        let ui = engine.ui.lock().unwrap();
        if ui.connections > 0 {
            let Some(pid) = ui.pid else { return Action::Nothing };
            self.opening_since = None;
            let hung = now.duration_since(ui.last_seen) >= HUNG;
            return if hung && live && self.may_reopen(now) { Action::Open(Some(pid)) } else { Action::Nothing };
        }
        if ui.detached {
            return if live { Action::Nothing } else { Action::Exit };
        }
        if self.opening_since.is_some_and(|at| now.duration_since(at) < STARTUP) {
            return Action::Nothing;
        }
        match live {
            true if self.may_reopen(now) => Action::Open(ui.pid),
            true => Action::Nothing,
            false => Action::Exit,
        }
    }
}

/// No vuelve: termina el proceso cuando ya no hace falta.
pub fn run(engine: Arc<Engine>, window_is_coming: bool) {
    let mut watch =
        Watch { opening_since: window_is_coming.then(Instant::now), reopens: Vec::new() };
    let mut last = Instant::now();
    let mut saved = None;
    let mut saved_at = Instant::now();
    let mut awake = false;
    loop {
        thread::sleep(EVERY);
        let now = Instant::now();
        if now.duration_since(last) > SUSPENDED {
            engine.ui.lock().unwrap().last_seen = now;
        }
        last = now;

        match watch.decide(&engine, now) {
            Action::Nothing => {}
            Action::Open(previous) => {
                if let Some(pid) = previous {
                    process::kill_window(pid);
                }
                watch.opened(now);
                process::open_window();
            }
            Action::Exit => exit(&engine.dir),
        }

        let state = Some((
            engine.show.lock().unwrap().rev(),
            engine.output.lock().unwrap().clone(),
            engine.ui.lock().unwrap().detached,
        ));
        if state != saved && saved_at.elapsed() >= SAVE_EVERY {
            saved = state;
            saved_at = Instant::now();
            save(&engine);
        }
        let running = engine.dmx_state() != "stopped";
        if running != awake {
            awake = running;
            process::keep_awake(awake);
        }
    }
}

/// Sin esperar al disco: es para retomar tras una caída del motor, no tras un
/// corte de luz (para eso está `show.json`).
fn save(engine: &Engine) {
    let Some(saved) = engine.save() else { return };
    let Ok(json) = serde_json::to_string(&saved) else { return };
    let (path, tmp) = (engine.dir.join(SESSION_FILE), engine.dir.join("session.json.tmp"));
    if fs::write(&tmp, json).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

/// Salida limpia: no queda sesión que retomar.
fn exit(dir: &Path) -> ! {
    let _ = fs::remove_file(dir.join(SESSION_FILE));
    std::process::exit(0);
}

/// Deja que la respuesta llegue antes de irse.
pub fn exit_soon(dir: &Path) {
    let dir = dir.to_owned();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(100));
        exit(&dir);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn engine(name: &str) -> Arc<Engine> {
        let dir = std::env::temp_dir().join(format!("lumenpro-watch-{name}-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        Engine::new(&dir)
    }

    fn ask(engine: &Engine, request: serde_json::Value) {
        engine.handle(serde_json::from_value(request).unwrap()).unwrap();
    }

    fn lights_on(engine: &Engine) {
        ask(engine, json!({ "cmd": "connect", "adapter": "mock", "port": "", "fps": 30 }));
    }

    fn window(engine: &Engine, pid: u32) {
        engine.ui.lock().unwrap().connections = 1;
        ask(engine, json!({ "cmd": "attach", "pid": pid }));
    }

    fn watch() -> Watch {
        Watch { opening_since: None, reopens: Vec::new() }
    }

    #[test]
    fn a_dead_window_is_reopened_while_the_lights_are_on() {
        let (engine, mut watch, now) = (engine("dead"), watch(), Instant::now());
        lights_on(&engine);
        window(&engine, 10);
        assert_eq!(watch.decide(&engine, now), Action::Nothing);
        engine.ui.lock().unwrap().connections = 0;
        assert_eq!(watch.decide(&engine, now), Action::Open(Some(10)));
        watch.opened(now);
        assert_eq!(watch.decide(&engine, now + Duration::from_secs(5)), Action::Nothing, "se le da tiempo de abrir");
        assert_eq!(watch.decide(&engine, now + STARTUP), Action::Open(Some(10)), "no abrió: se intenta otra vez");
    }

    #[test]
    fn with_nothing_on_a_dead_window_ends_the_engine() {
        let engine = engine("off");
        window(&engine, 10);
        engine.ui.lock().unwrap().connections = 0;
        assert_eq!(watch().decide(&engine, Instant::now()), Action::Exit);
    }

    #[test]
    fn closing_on_purpose_is_respected_and_the_lights_go_on() {
        let engine = engine("detach");
        lights_on(&engine);
        window(&engine, 10);
        ask(&engine, json!({ "cmd": "detach", "stop": false }));
        engine.ui.lock().unwrap().connections = 0;
        assert_eq!(watch().decide(&engine, Instant::now() + Duration::from_secs(600)), Action::Nothing);
        ask(&engine, json!({ "cmd": "disconnect" }));
        assert_eq!(watch().decide(&engine, Instant::now()), Action::Exit);
    }

    #[test]
    fn a_hung_window_is_replaced_but_a_slow_one_is_not() {
        let engine = engine("hung");
        lights_on(&engine);
        window(&engine, 4321);
        let now = Instant::now();
        assert_eq!(watch().decide(&engine, now + Duration::from_secs(10)), Action::Nothing);
        assert_eq!(watch().decide(&engine, now + HUNG + Duration::from_secs(1)), Action::Open(Some(4321)));
    }

    #[test]
    fn it_gives_up_reopening_if_it_keeps_falling_and_tries_later() {
        let engine = engine("loop");
        lights_on(&engine);
        window(&engine, 10);
        engine.ui.lock().unwrap().connections = 0;
        let (mut watch, start) = (watch(), Instant::now());
        for i in 0..MAX_REOPENS as u64 {
            let at = start + Duration::from_secs(i);
            watch.opening_since = None;
            assert_eq!(watch.decide(&engine, at), Action::Open(Some(10)));
            watch.opened(at);
        }
        watch.opening_since = None;
        assert_eq!(watch.decide(&engine, start + Duration::from_secs(30)), Action::Nothing);
        assert_eq!(watch.decide(&engine, start + REOPEN_WINDOW + Duration::from_secs(5)), Action::Open(Some(10)));
    }

    #[test]
    fn a_second_copy_only_gives_way_to_a_window_that_answers() {
        let engine = engine("focus");
        let focus = |engine: &Engine| engine.handle(serde_json::from_value(json!({ "cmd": "focus" })).unwrap()).unwrap();
        assert_eq!(focus(&engine), json!(null));
        window(&engine, 55);
        assert_eq!(focus(&engine), json!(55));
        assert!(engine.ui.lock().unwrap().focus);
        engine.ui.lock().unwrap().last_seen = Instant::now().checked_sub(RESPONSIVE).unwrap();
        assert_eq!(focus(&engine), json!(null));
    }
}
