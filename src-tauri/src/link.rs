//! Lado de la ventana: pasa los pedidos de la interfaz al proceso del motor
//! (`engine/`) y lo levanta si no está.

use crate::engine::{process, Client};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, Window, WindowEvent};

const ENGINE_START: Duration = Duration::from_secs(8);
/// Sin pedidos de la interfaz en este tiempo, está trabada: no puede preguntar.
const UI_RESPONSIVE: Duration = Duration::from_secs(4);

pub struct Link {
    dir: PathBuf,
    /// Una conexión para las órdenes y otra para las esperas: así una orden no
    /// hace cola detrás de una espera.
    lanes: [Mutex<Option<Client>>; 2],
    last_call: Mutex<Instant>,
    events: Mutex<Option<Channel<Value>>>,
}

fn connect(dir: &Path) -> Result<Client, String> {
    if let Some(client) = Client::connect(dir, true) {
        return Ok(client);
    }
    process::start_engine(dir);
    let limit = Instant::now() + ENGINE_START;
    while Instant::now() < limit {
        if let Some(client) = Client::connect(dir, true) {
            return Ok(client);
        }
        thread::sleep(Duration::from_millis(50));
    }
    Err("El motor de luces no arrancó. Cierra LUMEN PRO y vuelve a abrirlo.".into())
}

impl Link {
    /// La carpeta de datos, donde están engine.json y engine.lock.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            lanes: [Mutex::new(None), Mutex::new(None)],
            last_call: Mutex::new(Instant::now()),
            events: Mutex::new(None),
        }
    }

    fn call(&self, lane: usize, request: &str) -> Result<String, String> {
        let mut slot = self.lanes[lane.min(1)].lock().unwrap();
        if let Some(client) = slot.as_mut() {
            if let Ok(reply) = client.ask(request) {
                return Ok(reply);
            }
            // Se cayó el motor: el guardián lo está levantando.
            *slot = None;
        }
        let mut client = connect(&self.dir)?;
        let reply = client.ask(request).map_err(|e| format!("El motor de luces no responde: {e}"))?;
        *slot = Some(client);
        Ok(reply)
    }

    /// Por una conexión aparte y sin levantar el motor si no está: se usa al
    /// cerrar, que no puede quedarse esperando.
    pub fn ask(&self, request: Value) -> Option<Value> {
        let reply = Client::connect(&self.dir, false)?.ask(&request.to_string()).ok()?;
        serde_json::from_str::<Value>(&reply).ok().map(|mut r| r["ok"].take())
    }

    fn notify(&self, event: Value) -> bool {
        self.events.lock().unwrap().as_ref().is_some_and(|channel| channel.send(event).is_ok())
    }
}

/// Si ya hay una ventana abierta, la trae al frente. `true` = esta copia sobra.
pub fn yield_to_open_window(dir: &Path) -> bool {
    let Some(mut client) = Client::connect(dir, false) else { return false };
    let reply = client.ask(r#"{"cmd":"focus"}"#).unwrap_or_default();
    let reply: Value = serde_json::from_str(&reply).unwrap_or(Value::Null);
    let Some(pid) = reply["ok"].as_u64() else { return false };
    process::allow_foreground(pid as u32);
    true
}

/// Primer pedido de la interfaz: se presenta ante el motor, que le devuelve el
/// show si ya había uno en marcha.
#[tauri::command(async)]
pub fn engine_attach(link: State<'_, Link>, on_event: Channel<Value>) -> Result<String, String> {
    *link.events.lock().unwrap() = Some(on_event);
    *link.last_call.lock().unwrap() = Instant::now();
    link.call(0, &json!({ "cmd": "attach", "pid": std::process::id() }).to_string())
}

#[tauri::command(async)]
pub fn engine_call(link: State<'_, Link>, lane: usize, request: String) -> Result<String, String> {
    *link.last_call.lock().unwrap() = Instant::now();
    link.call(lane, &request)
}

/// Respuesta a "¿qué hago con las luces?" (ver `on_close`).
#[tauri::command(async)]
pub fn close_window(link: State<'_, Link>, window: Window, keep_lights: bool) -> Result<(), String> {
    link.ask(json!({ "cmd": "detach", "stop": !keep_lights }));
    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn focus_window(window: Window) {
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Cerrar la ventana con las luces encendidas pregunta primero. Si la interfaz
/// está trabada no puede preguntar: se cierra sin avisar al motor, que lo toma
/// por una caída y abre una ventana nueva.
pub fn on_close(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != "main" {
        return;
    }
    let link = window.state::<Link>();
    if link.ask(json!({ "cmd": "live" })) == Some(Value::Bool(true)) {
        let responsive = link.last_call.lock().unwrap().elapsed() < UI_RESPONSIVE;
        if responsive && link.notify(json!({ "type": "closeAsked" })) {
            api.prevent_close();
        }
    } else {
        link.ask(json!({ "cmd": "detach", "stop": true }));
    }
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
