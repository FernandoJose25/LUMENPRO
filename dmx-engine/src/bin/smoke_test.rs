//! Prueba manual de humo: corre el motor contra el Mock (o, si le pasás
//! un puerto como argumento, contra el adaptador real) y sube el dimmer de
//! los primeros 6 canales, imitando tus 6 fixtures sembrados
//! (2x Orus 280W, 4x Big Dipper LPC007 — ver fixtureLibrary.ts).
//!
//! Uso:
//!   cargo run --bin smoke_test              # sin hardware, contra Mock
//!   cargo run --bin smoke_test COM5         # cable FTDI (Open DMX)
//!   cargo run --bin smoke_test COM5 enttec  # Enttec DMX USB PRO

use lumenpro_dmx::{
    list_ports, DmxEngine, DmxOutput, DmxUniverse, EnttecUsbProOutput, MockOutput, OpenDmxOutput,
};
use std::time::Duration;

fn main() {
    let universe = DmxUniverse::new();
    let mut engine = DmxEngine::new(universe.clone());

    let port = std::env::args().nth(1);
    let enttec = std::env::args().nth(2).as_deref() == Some("enttec");
    if port.is_none() {
        println!("Sin puerto indicado, usando Mock (no toca hardware).");
        println!("Puertos serie detectados: {:?}", list_ports());
    }

    let started = engine.start(
        move || -> Result<Box<dyn DmxOutput>, _> {
            Ok(match &port {
                Some(port) if enttec => Box::new(EnttecUsbProOutput::open(port)?),
                Some(port) => Box::new(OpenDmxOutput::open(port)?),
                None => Box::new(MockOutput::new()),
            })
        },
        30,
    );
    if let Err(e) = started {
        eprintln!("No se pudo abrir el puerto: {e}");
        std::process::exit(1);
    }
    println!("Salida: {}", engine.status().output);

    // Direcciones sembradas hoy en fixtureLibrary.ts (SIN CONFIRMAR contra
    // la MAX 512 — ver AUDIT.md y tu paso 1 pendiente):
    // Orus #1 @1, Orus #2 @17, LPC007 #1 @33, #2 @40, #3 @47, #4 @54.
    println!("Subiendo dimmers de los 6 fixtures sembrados durante 3s...");
    universe.set_channel(6, 255); // Orus #1 - Dimmer (canal 6 del def-orus-280)
    universe.set_channel(7, 255); // Orus #1 - Strobe abierto
    universe.set_channel(22, 255); // Orus #2 - Dimmer (17 + 5)
    universe.set_channel(23, 255); // Orus #2 - Strobe abierto
    universe.set_channel(33, 255); // LPC007 #1 - Master Dimmer
    universe.set_channel(40, 255); // LPC007 #2 - Master Dimmer
    universe.set_channel(47, 255); // LPC007 #3 - Master Dimmer
    universe.set_channel(54, 255); // LPC007 #4 - Master Dimmer
    for address in [33, 40, 47, 54] {
        // El Master Dimmer solo no enciende un PAR: hace falta color.
        universe.set_block(address + 1, &[255, 255, 255]); // RGB blanco
    }

    std::thread::sleep(Duration::from_secs(3));
    let status = engine.status();
    println!("{:?} a {} fps, último error: {:?}", status.state, status.fps, status.last_error);

    println!("Blackout.");
    universe.blackout();
    std::thread::sleep(Duration::from_millis(200));

    engine.stop();
    println!("Listo.");
}
