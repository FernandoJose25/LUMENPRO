//! Hilo de salida: lee el `DmxUniverse` a una frecuencia fija (FPS) y lo
//! manda por el `DmxOutput` activo. Este es el "motor DMX en Rust" del
//! roadmap (paso 2, antes de Tauri).
//!
//! Diseño deliberadamente simple para esta primera versión: un solo
//! universe, un solo output, sin reconexión automática todavía. Cuando
//! integres esto en `src-tauri`, los comandos Tauri (`connect`, `disconnect`,
//! `set_channel`, etc.) van a envolver este `DmxEngine`.

use crate::output::{DmxOutput, DmxOutputError};
use crate::universe::DmxUniverse;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub struct DmxEngine {
    universe: DmxUniverse,
    running: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl DmxEngine {
    pub fn new(universe: DmxUniverse) -> Self {
        Self {
            universe,
            running: Arc::new(AtomicBool::new(false)),
            handle: None,
        }
    }

    pub fn universe(&self) -> DmxUniverse {
        self.universe.clone()
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    /// Arranca el hilo de salida. `fps` típico: 30-40 (el hardware ENTTEC
    /// soporta 1-40 FPS configurables). Si ya había un hilo corriendo, lo
    /// detiene antes de arrancar el nuevo (por ejemplo al cambiar de output).
    pub fn start(&mut self, mut output: Box<dyn DmxOutput>, fps: u32) {
        self.stop();

        let universe = self.universe.clone();
        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();

        let frame_duration = Duration::from_secs_f64(1.0 / fps.max(1) as f64);

        let handle = thread::spawn(move || {
            while running.load(Ordering::SeqCst) {
                let tick_start = Instant::now();

                let frame = universe.snapshot();
                if let Err(err) = output.send_frame(&frame) {
                    // No tumbamos el hilo por un error puntual de E/S (p.ej.
                    // un glitch de USB): lo reportamos y seguimos intentando
                    // en el siguiente tick. Si el error persiste, la UI lo
                    // verá porque `frames_sent`/latencia dejarán de avanzar
                    // — ese contador es cosa de la capa Tauri, no de este motor.
                    eprintln!("[lumenpro_dmx] error enviando frame a {}: {err}", output.name());
                }

                let elapsed = tick_start.elapsed();
                if elapsed < frame_duration {
                    thread::sleep(frame_duration - elapsed);
                }
            }
        });

        self.handle = Some(handle);
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
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
        let output = Box::new(SharedMock(shared.clone()));

        let mut engine = DmxEngine::new(universe);
        engine.start(output, 20); // 20 fps => ~50ms/frame

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
        engine.start(Box::new(MockOutput::new()), 30);
        engine.stop();
        engine.stop(); // no debe entrar en pánico al llamarlo dos veces
        assert!(!engine.is_running());
    }
}
