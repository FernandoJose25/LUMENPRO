// Evita la consola extra en Windows para builds release. NO QUITAR.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! LUMEN PRO son dos programas en un mismo `.exe`: la ventana (Tauri, este
//! archivo y `link.rs`) y el motor (`engine/`), que corre en otro proceso para
//! que las luces no dependan de la ventana. La ventana además guarda el show
//! en disco (`show.rs`).

mod engine;
mod link;
mod show;
mod stage_window;
mod updates;
mod webview_dir;

use engine::process;
use lumenpro_dmx::PortChip;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, WebviewWindowBuilder};

#[derive(Serialize)]
struct SerialPort {
    name: String,
    chip: &'static str,
    description: String,
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

const RELEASES: &str = "https://github.com/FernandoJose25/LUMENPRO/releases/latest";

/// Abre la página de descargas en el navegador. Solo esa dirección: la
/// interfaz no puede pedir que se abra cualquier cosa.
#[tauri::command(async)]
fn open_release_page() -> Result<(), String> {
    #[cfg(windows)]
    let opened = std::process::Command::new("explorer.exe").arg(RELEASES).spawn();
    #[cfg(not(windows))]
    let opened = std::process::Command::new("xdg-open").arg(RELEASES).spawn();
    opened.map(|_| ()).map_err(|e| e.to_string())
}

/// Se crea a mano (`"create": false` en tauri.conf.json) para no mostrar nada
/// si ya hay otra copia abierta.
fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    let config = app.config().app.windows.first().expect("la ventana principal está en tauri.conf.json");
    let dir = webview_dir::pick(&app.path().app_local_data_dir()?);
    WebviewWindowBuilder::from_config(app, config)?.data_directory(dir.clone()).build()?;
    app.manage(WebviewDir(dir));
    Ok(())
}

/// Donde está el navegador de la ventana: todas tienen que usar el mismo.
pub struct WebviewDir(pub PathBuf);

fn window() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let dir = link::data_dir(app.handle())?;
            if link::yield_to_open_window(&dir) {
                std::process::exit(0);
            }
            app.manage(link::Link::new(dir));
            open_main_window(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            link::on_close(window, event);
            stage_window::close_with_main(window, event);
        })
        // Solo se pide al pulsar "Escuchar" (src/lib/audioInput.ts). Con el
        // aviso de WebView2, un "Bloquear" por error queda guardado y no hay
        // dónde deshacerlo. El permiso de Windows sigue mandando.
        .on_permission_request(|_, kind| match kind {
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            open_release_page,
            link::engine_attach,
            link::engine_call,
            link::close_window,
            link::focus_window,
            show::load_show,
            show::save_show,
            show::export_show,
            show::load_settings,
            show::save_settings,
            show::save_song,
            show::read_song,
            stage_window::open_stage_window,
            updates::check_update,
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error corriendo la app de Tauri");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // El directorio es siempre el último argumento (ver engine/process.rs).
    let dir = Path::new(args.last().expect("el primero es el propio programa"));
    match args.get(1).map(String::as_str) {
        Some(process::LAUNCH) => process::launch(dir),
        Some(process::GUARD) => process::guard(dir),
        Some(process::ENGINE) => process::engine(dir, &args),
        _ => window(),
    }
}
