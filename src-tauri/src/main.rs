// Evita la consola extra en Windows para builds release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Capa Tauri de LUMEN PRO. Envuelve `lumenpro_dmx` (crate `dmx-engine/`,
//! ver AUDIT.md §8) en comandos invocables desde el frontend React.
//!
//! Estado de este archivo: escrito como paso 3 del roadmap (PASOS-PENDIENTES.md),
//! pero SIN verificar contra un build real — el sandbox donde se escribió no
//! tenía los paquetes de sistema `libwebkit2gtk-4.1-dev` disponibles (fallo del
//! mirror de Ubuntu, no del código), así que ni `cargo check` ni `cargo tauri dev`
//! se pudieron correr aquí. Antes de confiar en esto, alguien con un entorno
//! Tauri completo (o Windows, que es el target real) debe correr `cargo tauri dev`
//! y arreglar lo que falle. Tampoco hay iconos reales todavía (ver `icons/README.md`).

use lumenpro_dmx::{DmxEngine, DmxUniverse, EnttecUsbProOutput, MockOutput, CHANNEL_COUNT};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// Estado compartido de la app: un único universo DMX + el motor que lo
/// saca por hardware. El universo vive separado del motor a propósito:
/// los comandos de escritura de canal (`set_channel`, `set_block`,
/// `blackout`) deben funcionar aunque el motor todavía no esté conectado
/// a ningún output — el motor solo controla el hilo de salida, no es
/// dueño de los datos (ver dmx-engine/src/universe.rs).
struct DmxState {
    universe: DmxUniverse,
    engine: Mutex<DmxEngine>,
}

#[derive(Serialize)]
struct EngineStatus {
    running: bool,
}

fn poisoned() -> String {
    "el lock del motor DMX está envenenado (un hilo entró en pánico mientras lo tenía tomado)"
        .to_string()
}

/// Lista los puertos serie disponibles, para que la UI le muestre al
/// usuario un selector antes de conectar al Enttec DMX USB PRO real.
#[tauri::command]
fn list_serial_ports() -> Result<Vec<String>, String> {
    EnttecUsbProOutput::list_ports().map_err(|e| e.to_string())
}

/// Conecta el motor a un output Mock (sin hardware). Útil para probar
/// la UI de Scenes/Chases/Effects sin tener el Enttec ni la consola
/// MAX 512 a mano (ver paso 1 pendiente en PASOS-PENDIENTES.md).
#[tauri::command]
fn connect_mock(state: State<DmxState>, fps: u32) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(|_| poisoned())?;
    engine.start(Box::new(MockOutput::new()), fps);
    Ok(())
}

/// Conecta el motor a un Enttec DMX USB PRO real por el puerto serie
/// indicado (uno de los que devuelve `list_serial_ports`).
#[tauri::command]
fn connect_enttec(state: State<DmxState>, port: String, fps: u32) -> Result<(), String> {
    let output = EnttecUsbProOutput::open(&port).map_err(|e| e.to_string())?;
    let mut engine = state.engine.lock().map_err(|_| poisoned())?;
    engine.start(Box::new(output), fps);
    Ok(())
}

/// Detiene el hilo de salida (no borra el universo — para eso está `blackout`).
#[tauri::command]
fn disconnect(state: State<DmxState>) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(|_| poisoned())?;
    engine.stop();
    Ok(())
}

#[tauri::command]
fn engine_status(state: State<DmxState>) -> Result<EngineStatus, String> {
    let engine = state.engine.lock().map_err(|_| poisoned())?;
    Ok(EngineStatus {
        running: engine.is_running(),
    })
}

#[tauri::command]
fn set_channel(state: State<DmxState>, channel: u16, value: u8) {
    state.universe.set_channel(channel, value);
}

#[tauri::command]
fn get_channel(state: State<DmxState>, channel: u16) -> u8 {
    state.universe.get_channel(channel)
}

/// Escribe un bloque contiguo de canales (p.ej. el volcado completo de un
/// fixture: address..address+channel_count) en una sola llamada IPC, en
/// vez de una invocación por canal.
#[tauri::command]
fn set_block(state: State<DmxState>, start_channel: u16, values: Vec<u8>) {
    state.universe.set_block(start_channel, &values);
}

/// Blackout: pone los 512 canales a 0 sin tocar el hilo de salida ni
/// la conexión al hardware.
#[tauri::command]
fn blackout(state: State<DmxState>) {
    state.universe.set_block(1, &[0u8; CHANNEL_COUNT]);
}

fn main() {
    let universe = DmxUniverse::new();
    let engine = Mutex::new(DmxEngine::new(universe.clone()));

    tauri::Builder::default()
        .manage(DmxState { universe, engine })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_mock,
            connect_enttec,
            disconnect,
            engine_status,
            set_channel,
            get_channel,
            set_block,
            blackout,
        ])
        .run(tauri::generate_context!())
        .expect("error corriendo la app de Tauri");
}
