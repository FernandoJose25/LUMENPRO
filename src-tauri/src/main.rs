// Evita la consola extra en Windows para builds release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Capa Tauri de LUMEN PRO. Envuelve `lumenpro_dmx` (crate `dmx-engine/`,
//! ver AUDIT.md §8) en comandos invocables desde el frontend React, y guarda
//! el show en disco.
//!
//! El frontend es la fuente de verdad de los valores: calcula los 512 canales
//! (`src/lib/dmxFrame.ts`, incluido el Blackout) y los manda con `set_block`.
//! Acá no hay un "blackout" propio a propósito: poner los 512 canales a 0
//! también movería Pan/Tilt y las cabezas girarían de golpe.

mod show;

use lumenpro_dmx::{
    DmxEngine, DmxOutput, DmxOutputError, DmxUniverse, EngineState, EnttecUsbProOutput, MockOutput,
    OpenDmxOutput, PortChip,
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// Estado compartido de la app: un único universo DMX + el motor que lo
/// saca por hardware. El universo vive separado del motor a propósito:
/// `set_block` debe funcionar aunque el motor todavía no esté conectado a
/// ningún output — el motor solo controla el hilo de salida, no es dueño de
/// los datos (ver dmx-engine/src/universe.rs).
struct DmxState {
    universe: DmxUniverse,
    engine: Mutex<DmxEngine>,
}

#[derive(Serialize)]
struct SerialPort {
    name: String,
    chip: &'static str,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatus {
    state: &'static str,
    output: String,
    last_error: Option<String>,
    fps: u32,
}

fn poisoned() -> String {
    "el lock del motor DMX está envenenado (un hilo entró en pánico mientras lo tenía tomado)"
        .to_string()
}

/// Los comandos que abren o cierran puertos son `async`: corren fuera del
/// hilo de la ventana, así un driver USB lento no congela la interfaz.
fn start_engine<F>(state: &DmxState, fps: u32, open: F) -> Result<(), String>
where
    F: Fn() -> Result<Box<dyn DmxOutput>, DmxOutputError> + Send + 'static,
{
    let mut engine = state.engine.lock().map_err(|_| poisoned())?;
    engine.start(open, fps).map_err(|e| e.to_string())
}

/// Lista los puertos serie disponibles, para que la UI muestre un selector
/// y avise si el adaptador trae un chip que no es FTDI.
#[tauri::command(async)]
fn list_serial_ports() -> Result<Vec<SerialPort>, String> {
    let ports = lumenpro_dmx::list_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| SerialPort {
            name: p.name,
            chip: match p.chip {
                PortChip::Ftdi => "ftdi",
                PortChip::Ch340 => "ch340",
                PortChip::Other => "other",
            },
            description: p.description,
        })
        .collect())
}

/// Conecta el motor a un output Mock (sin hardware), para ensayar un show
/// sin tener el adaptador a mano.
#[tauri::command(async)]
fn connect_mock(state: State<'_, DmxState>, fps: u32) -> Result<(), String> {
    start_engine(&state, fps, || Ok(Box::new(MockOutput::new())))
}

/// Cable FTDI barato (Open DMX): el timing lo genera la PC.
#[tauri::command(async)]
fn connect_open_dmx(state: State<'_, DmxState>, port: String, fps: u32) -> Result<(), String> {
    start_engine(&state, fps, move || Ok(Box::new(OpenDmxOutput::open(&port)?)))
}

/// Enttec DMX USB PRO (o compatible): el timing lo genera el adaptador.
#[tauri::command(async)]
fn connect_enttec(state: State<'_, DmxState>, port: String, fps: u32) -> Result<(), String> {
    start_engine(&state, fps, move || Ok(Box::new(EnttecUsbProOutput::open(&port)?)))
}

/// Detiene el hilo de salida (no borra el universo).
#[tauri::command(async)]
fn disconnect(state: State<'_, DmxState>) -> Result<(), String> {
    let mut engine = state.engine.lock().map_err(|_| poisoned())?;
    engine.stop();
    Ok(())
}

#[tauri::command(async)]
fn engine_status(state: State<'_, DmxState>) -> Result<EngineStatus, String> {
    let status = state.engine.lock().map_err(|_| poisoned())?.status();
    Ok(EngineStatus {
        state: match status.state {
            EngineState::Stopped => "stopped",
            EngineState::Running => "running",
            EngineState::Reconnecting => "reconnecting",
        },
        output: status.output,
        last_error: status.last_error,
        fps: status.fps,
    })
}

/// Escribe un bloque contiguo de canales. La UI manda el universo completo
/// (start_channel = 1, 512 valores) en una sola llamada IPC.
#[tauri::command]
fn set_block(state: State<'_, DmxState>, start_channel: u16, values: Vec<u8>) {
    state.universe.set_block(start_channel, &values);
}

fn main() {
    let universe = DmxUniverse::new();
    let engine = Mutex::new(DmxEngine::new(universe.clone()));

    tauri::Builder::default()
        .manage(DmxState { universe, engine })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_mock,
            connect_open_dmx,
            connect_enttec,
            disconnect,
            engine_status,
            set_block,
            show::load_show,
            show::save_show,
            show::export_show,
        ])
        .run(tauri::generate_context!())
        .expect("error corriendo la app de Tauri");
}
