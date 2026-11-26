//! Versiones nuevas: se buscan en GitHub (latest.json del último release) y
//! se instalan solas. Antes de instalar se apaga el motor: el instalador no
//! puede reemplazar un programa que sigue corriendo.

use crate::link::Link;
use serde::Serialize;
use serde_json::json;
use std::fs::File;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
pub struct Available {
    version: String,
    notes: Option<String>,
}

/// La versión nueva, o nada. Sin internet (en un local, lo normal) tampoco.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<Available>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| Available { version: u.version.clone(), notes: u.body.clone() }))
}

/// Descarga (avisando el porcentaje), apaga las luces y el motor, e instala.
/// En Windows el programa se cierra solo y el instalador lo vuelve a abrir.
#[tauri::command]
pub async fn install_update(app: AppHandle, link: State<'_, Link>, progress: Channel<u32>) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("Ya no hay una versión nueva")?;
    let mut done = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let _ = progress.send((done * 100 / total).min(100) as u32);
                }
            },
            || {},
        )
        .await
        .map_err(|e| format!("No se pudo descargar: {e}"))?;

    link.ask(json!({ "cmd": "detach", "stop": true }));
    wait_engine_gone(link.dir());
    update.install(bytes).map_err(|e| format!("No se pudo instalar: {e}"))
}

/// El motor suelta su candado al salir; el guardián sale detrás de él.
fn wait_engine_gone(dir: &std::path::Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let free = File::create(dir.join("engine.lock")).is_ok_and(|f| f.try_lock().is_ok());
        if free {
            std::thread::sleep(Duration::from_millis(500));
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
