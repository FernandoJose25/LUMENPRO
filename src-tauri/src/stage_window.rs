//! Segunda ventana con solo el simulador, para otro monitor o un proyector.
//! Los datos le llegan de la principal dentro del webview (ver
//! `src/lib/stageMirror.ts`); acá solo se crea y se cierra.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

const MAIN: &str = "main";
const STAGE: &str = "stage";

/// `async`: crear una ventana desde el hilo principal se bloquea en Windows.
#[tauri::command(async)]
pub fn open_stage_window(app: AppHandle) -> Result<(), String> {
    if let Some(open) = app.get_webview_window(STAGE) {
        return open.set_focus().map_err(|e| e.to_string());
    }
    create(&app).map_err(|e| format!("No se pudo abrir la ventana: {e}"))
}

fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = WebviewWindowBuilder::new(app, STAGE, WebviewUrl::App("index.html#escenario".into()))
        .title("LUMEN PRO — Escenario")
        .inner_size(1280.0, 720.0)
        .visible(false);
    // WebView2 no abre una segunda ventana si los argumentos no son idénticos
    // a los de la primera.
    let config = app.config();
    let main_args = config.app.windows.first().and_then(|w| w.additional_browser_args.as_deref());
    if let Some(args) = main_args {
        builder = builder.additional_browser_args(args);
    }
    let window = builder.build()?;
    if let Some(position) = other_monitor(app)? {
        window.set_position(position)?;
        window.maximize()?;
    }
    window.show()
}

/// Dónde empieza un monitor que no sea el de la ventana principal.
fn other_monitor(app: &AppHandle) -> tauri::Result<Option<tauri::PhysicalPosition<i32>>> {
    let Some(main) = app.get_webview_window(MAIN) else { return Ok(None) };
    let current = main.current_monitor()?.map(|m| *m.position());
    Ok(main.available_monitors()?.iter().map(|m| *m.position()).find(|p| Some(*p) != current))
}

/// Al cerrar la principal se cierra también: si no, la app seguiría viva, con
/// el DMX saliendo y sin controles.
pub fn close_with_main(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN || !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    if let Some(stage) = window.app_handle().get_webview_window(STAGE) {
        let _ = stage.destroy();
    }
}
