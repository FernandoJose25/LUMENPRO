//! Prueba manual de humo: corre el motor contra el Mock (o, si le pasás
//! un puerto como argumento, contra un Enttec real) y sube el dimmer de
//! los primeros 6 canales, imitando tus 6 fixtures sembrados
//! (2x Orus 280W, 4x Big Dipper LPC007 — ver fixtureLibrary.ts).
//!
//! Uso:
//!   cargo run --bin smoke_test              # sin hardware, contra Mock
//!   cargo run --bin smoke_test /dev/ttyUSB0  # contra Enttec real
//!   cargo run --bin smoke_test COM5          # en Windows

use lumenpro_dmx::{DmxEngine, DmxOutput, DmxUniverse, EnttecUsbProOutput, MockOutput};
use std::time::Duration;

fn main() {
    let universe = DmxUniverse::new();
    let mut engine = DmxEngine::new(universe.clone());

    let port_arg = std::env::args().nth(1);
    let output: Box<dyn DmxOutput> = match port_arg {
        Some(port) => {
            println!("Conectando a Enttec DMX USB PRO en {port}...");
            match EnttecUsbProOutput::open(&port) {
                Ok(o) => Box::new(o),
                Err(e) => {
                    eprintln!("No se pudo abrir {port}: {e}. Usando Mock.");
                    Box::new(MockOutput::new())
                }
            }
        }
        None => {
            println!("Sin puerto indicado, usando Mock (no toca hardware).");
            println!("Puertos serie detectados: {:?}", EnttecUsbProOutput::list_ports());
            Box::new(MockOutput::new())
        }
    };

    engine.start(output, 30);

    // Direcciones sembradas hoy en fixtureLibrary.ts (SIN CONFIRMAR contra
    // la MAX 512 — ver AUDIT.md y tu paso 1 pendiente):
    // Orus #1 @1, Orus #2 @17, LPC007 #1 @33, #2 @40, #3 @47, #4 @54.
    println!("Subiendo dimmers de los 6 fixtures sembrados durante 3s...");
    universe.set_channel(6, 255); // Orus #1 - Dimmer (canal 6 del def-orus-280)
    universe.set_channel(22, 255); // Orus #2 - Dimmer (17 + 5)
    universe.set_channel(33, 255); // LPC007 #1 - Master Dimmer
    universe.set_channel(40, 255); // LPC007 #2 - Master Dimmer
    universe.set_channel(47, 255); // LPC007 #3 - Master Dimmer
    universe.set_channel(54, 255); // LPC007 #4 - Master Dimmer

    std::thread::sleep(Duration::from_secs(3));

    println!("Blackout.");
    universe.blackout();
    std::thread::sleep(Duration::from_millis(200));

    engine.stop();
    println!("Listo.");
}
