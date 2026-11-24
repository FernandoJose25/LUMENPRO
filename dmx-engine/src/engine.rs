//! Hilo de salida: lee el `DmxUniverse` a una frecuencia fija (FPS) y lo
//! manda por el `DmxOutput` activo. Este es el "motor DMX en Rust" del
//! roadmap (paso 2, antes de Tauri).
//!
//! Diseño deliberadamente simple: un solo universe, un solo output. Si el
//! cable se desconecta, el hilo lo reporta en `status()` e intenta reabrir
//! el puerto hasta que vuelva — el show no depende de que alguien lo note.

use crate::output::{DmxOutput, DmxOutputError};
use crate::universe::DmxUniverse;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Errores de envío seguidos antes de dar el puerto por perdido: un glitch
/// puntual de USB no justifica cerrar y reabrir en medio del show.
const MAX_CONSECUTIVE_ERRORS: u32 = 3;
const RECONNECT_EVERY: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EngineState {
    #[default]
    Stopped,
    Running,
    Reconnecting,
}

#[derive(Debug, Clone, Default)]
pub struct EngineStatus {
    pub state: EngineState,
    /// `DmxOutput::name()` del output activo (o del que se está reabriendo).
    pub output: String,
    pub last_error: Option<String>,
    /// Frames por segundo reales del último segundo, no los configurados.
    pub fps: u32,
}

pub struct DmxEngine {
    universe: DmxUniverse,
    running: Arc<AtomicBool>,
    status: Arc<Mutex<EngineStatus>>,
    handle: Option<JoinHandle<()>>,
}

impl DmxEngine {
    pub fn new(universe: DmxUniverse) -> Self {
        Self {
            universe,
            running: Arc::new(AtomicBool::new(false)),
            status: Arc::new(Mutex::new(EngineStatus::default())),
            handle: None,
        }
    }

    pub fn status(&self) -> EngineStatus {
        self.status.lock().expect("lock de estado envenenado").clone()
    }

    pub fn universe(&self) -> DmxUniverse {
        self.universe.clone()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Arranca el hilo de salida. `fps` típico: 30 (el tope físico del DMX
    /// con 512 canales es 44). Si ya había un hilo corriendo, lo detiene antes
    /// de arrancar el nuevo (por ejemplo al cambiar de output).
    ///
    /// `open` abre el output y se vuelve a llamar cada vez que haya que
    /// reconectar. Si la PRIMERA apertura falla se devuelve el error (puerto
    /// ocupado, inexistente) y no queda ningún hilo corriendo.
    pub fn start<F>(&mut self, open: F, fps: u32) -> Result<(), DmxOutputError>
    where
        F: Fn() -> Result<Box<dyn DmxOutput>, DmxOutputError> + Send + 'static,
    {
        // Antes de abrir: un puerto COM solo admite un dueño a la vez, y el
        // hilo anterior puede ser quien lo tiene tomado.
        self.stop();

        let mut output = Some(open()?);
        self.update_status(|s| {
            *s = EngineStatus {
                state: EngineState::Running,
                output: output.as_ref().map(|o| o.name()).unwrap_or_default(),
                ..EngineStatus::default()
            }
        });

        let universe = self.universe.clone();
        let status = self.status.clone();
        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();

        let frame_duration = Duration::from_secs_f64(1.0 / fps.max(1) as f64);

        let handle = thread::spawn(move || {
            let set_status = |f: &dyn Fn(&mut EngineStatus)| {
                f(&mut status.lock().expect("lock de estado envenenado"))
            };
            let mut consecutive_errors = 0;
            let mut last_attempt = Instant::now();
            let mut window_start = Instant::now();
            let mut window_frames = 0u32;

            while running.load(Ordering::SeqCst) {
                let tick_start = Instant::now();

                if let Some(out) = output.as_mut() {
                    match out.send_frame(&universe.snapshot()) {
                        Ok(()) => {
                            consecutive_errors = 0;
                            window_frames += 1;
                        }
                        Err(err) => {
                            consecutive_errors += 1;
                            let message = err.to_string();
                            set_status(&|s| s.last_error = Some(message.clone()));
                            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                                // Soltar el puerto ANTES de reintentar: si no,
                                // el propio handle viejo bloquea la reapertura.
                                output = None;
                                last_attempt = Instant::now();
                                set_status(&|s| s.state = EngineState::Reconnecting);
                            }
                        }
                    }
                } else if last_attempt.elapsed() >= RECONNECT_EVERY {
                    last_attempt = Instant::now();
                    match open() {
                        Ok(out) => {
                            output = Some(out);
                            consecutive_errors = 0;
                            set_status(&|s| {
                                s.state = EngineState::Running;
                                s.last_error = None;
                            });
                        }
                        Err(err) => {
                            let message = err.to_string();
                            set_status(&|s| s.last_error = Some(message.clone()));
                        }
                    }
                }

                if window_start.elapsed() >= Duration::from_secs(1) {
                    let fps = (window_frames as f64 / window_start.elapsed().as_secs_f64()).round();
                    set_status(&|s| s.fps = fps as u32);
                    window_start = Instant::now();
                    window_frames = 0;
                }

                let elapsed = tick_start.elapsed();
                if elapsed < frame_duration {
                    thread::sleep(frame_duration - elapsed);
                }
            }
        });

        self.handle = Some(handle);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        self.update_status(|s| *s = EngineStatus::default());
    }

    fn update_status(&self, f: impl FnOnce(&mut EngineStatus)) {
        f(&mut self.status.lock().expect("lock de estado envenenado"));
    }
}

impl Drop for DmxEngine {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Error de conveniencia para reexportar en la capa Tauri.
pub type EngineOutputError = DmxOutputError;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::output::MockOutput;
    use std::sync::{Arc, Mutex};

    // Wrapper que comparte el conteo de frames con el test, ya que
    // `MockOutput` real se mueve dentro del hilo del motor.
    struct SharedMock(Arc<Mutex<MockOutput>>);
    impl DmxOutput for SharedMock {
        fn send_frame(&mut self, frame: &[u8; crate::universe::CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
            self.0.lock().unwrap().send_frame(frame)
        }
        fn name(&self) -> String {
            "SharedMock".into()
        }
    }

    #[test]
    fn engine_sends_frames_at_configured_rate() {
        let universe = DmxUniverse::new();
        universe.set_channel(1, 42);

        let shared = Arc::new(Mutex::new(MockOutput::new()));
        let for_output = shared.clone();

        let mut engine = DmxEngine::new(universe);
        engine
            .start(move || Ok(Box::new(SharedMock(for_output.clone()))), 20) // 20 fps => ~50ms/frame
            .unwrap();

        thread::sleep(Duration::from_millis(260));
        engine.stop();

        let sent = shared.lock().unwrap().frames_sent;
        // A 20fps en ~260ms esperamos ~5 frames; damos margen amplio
        // porque el scheduler del sandbox de CI puede ser lento.
        assert!(sent >= 2, "se esperaban al menos 2 frames, se enviaron {sent}");
        assert_eq!(shared.lock().unwrap().last_frame[0], 42);
    }

    #[test]
    fn stop_joins_thread_and_is_idempotent() {
        let universe = DmxUniverse::new();
        let mut engine = DmxEngine::new(universe);
        engine.start(|| Ok(Box::new(MockOutput::new())), 30).unwrap();
        engine.stop();
        engine.stop(); // no debe entrar en pánico al llamarlo dos veces
        assert!(!engine.is_running());
        assert_eq!(engine.status().state, EngineState::Stopped);
    }

    fn unplugged() -> DmxOutputError {
        std::io::Error::new(std::io::ErrorKind::BrokenPipe, "cable desconectado").into()
    }

    /// Cable que se puede "desenchufar" desde el test.
    struct Pluggable(Arc<AtomicBool>);
    impl DmxOutput for Pluggable {
        fn send_frame(&mut self, _: &[u8; crate::universe::CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
            if self.0.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(unplugged())
            }
        }
        fn name(&self) -> String {
            "Pluggable".into()
        }
    }

    #[test]
    fn failed_first_open_reports_the_error_and_leaves_engine_stopped() {
        let mut engine = DmxEngine::new(DmxUniverse::new());
        assert!(engine.start(|| Err(unplugged()), 30).is_err());
        assert!(!engine.is_running());
        assert_eq!(engine.status().state, EngineState::Stopped);
    }

    #[test]
    fn unplugging_is_reported_and_plugging_back_reconnects_alone() {
        let plugged = Arc::new(AtomicBool::new(true));
        let for_open = plugged.clone();
        let mut engine = DmxEngine::new(DmxUniverse::new());
        engine
            .start(
                move || {
                    if for_open.load(Ordering::SeqCst) {
                        Ok(Box::new(Pluggable(for_open.clone())))
                    } else {
                        Err(unplugged())
                    }
                },
                50,
            )
            .unwrap();

        plugged.store(false, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(300));
        let status = engine.status();
        assert_eq!(status.state, EngineState::Reconnecting);
        assert!(status.last_error.unwrap().contains("cable desconectado"));

        plugged.store(true, Ordering::SeqCst);
        thread::sleep(RECONNECT_EVERY + Duration::from_millis(400));
        let status = engine.status();
        assert_eq!(status.state, EngineState::Running);
        assert_eq!(status.last_error, None);
    }
}
