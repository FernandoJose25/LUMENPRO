//! lumenpro_dmx — motor DMX de LUMENPRO.
//!
//! Punto de entrada de la librería. Pensado para integrarse en `src-tauri`
//! como dependencia local (`path = "../lumenpro-dmx-engine"`) cuando llegue
//! el paso 3 del roadmap (empaquetado Tauri). Mientras tanto se puede
//! compilar y probar de forma completamente independiente (`cargo test`,
//! `cargo run --bin smoke_test`).

pub mod engine;
pub mod output;
pub mod universe;

pub use engine::DmxEngine;
pub use output::{DmxOutput, DmxOutputError, EnttecUsbProOutput, MockOutput};
pub use universe::{DmxUniverse, CHANNEL_COUNT};
