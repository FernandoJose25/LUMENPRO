//! Control por celular: un servidor HTTP mínimo en la red local que sirve una
//! página (`remote.html`) y hace de relevo. No sabe de luces: recibe del
//! frontend una foto del estado (`remote_publish`) y le reenvía las órdenes
//! por un `Channel`. La fuente de verdad sigue siendo `fixtureStore`.
//!
//! Va por HTTP sin cifrar, así que el PIN protege de curiosos, no de alguien
//! espiando una WiFi abierta: se usa en una red propia con contraseña.

use crate::show::write_atomic;
use qrcodegen::{QrCode, QrCodeEcc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server};

/// Fijo para que la dirección del celular no cambie entre eventos.
const PORT: u16 = 8777;
const PAGE: &str = include_str!("remote.html");
const WORKERS: usize = 8;
const MAX_BODY: u64 = 1024;
const MAX_FAILS: u32 = 5;
const LOCKOUT: Duration = Duration::from_secs(60);

/// Se guarda en disco: si la app se cierra en pleno evento, al abrirla el
/// celular vuelve a conectar solo, sin pedir el PIN otra vez.
#[derive(Clone, Serialize, Deserialize)]
struct Config {
    enabled: bool,
    pin: String,
    token: String,
}

impl Config {
    fn generate(enabled: bool) -> Self {
        let mut bytes = [0u8; 20];
        getrandom::fill(&mut bytes).expect("el sistema no entrega números aleatorios");
        let pin = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
        Self {
            enabled,
            pin: format!("{pin:06}"),
            token: bytes[4..].iter().map(|b| format!("{b:02x}")).collect(),
        }
    }
}

type Sink = Box<dyn Fn(Value) + Send>;

struct Reply {
    status: u16,
    content_type: &'static str,
    body: String,
}

impl Reply {
    fn empty(status: u16) -> Self {
        Self { status, content_type: "text/plain", body: String::new() }
    }

    fn json(status: u16, body: String) -> Self {
        Self { status, content_type: "application/json", body }
    }
}

struct Hub {
    config: Mutex<Config>,
    /// Versión y JSON de la última foto publicada por el frontend.
    snapshot: Mutex<(u64, String)>,
    fails: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    sink: Mutex<Option<Sink>>,
}

fn unix_millis() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

impl Hub {
    fn new(config: Config) -> Self {
        Self {
            config: Mutex::new(config),
            // Arranca en la hora actual para que, tras reiniciar la app, un
            // celular con una versión vieja no crea que ya la tiene.
            snapshot: Mutex::new((unix_millis(), "null".into())),
            fails: Mutex::new(HashMap::new()),
            sink: Mutex::new(None),
        }
    }

    fn publish(&self, state: String) {
        let mut snapshot = self.snapshot.lock().unwrap();
        *snapshot = (snapshot.0 + 1, state);
    }

    fn handle(&self, method: &Method, url: &str, bearer: Option<&str>, ip: IpAddr, body: &str) -> Reply {
        let (path, query) = url.split_once('?').unwrap_or((url, ""));
        match (method, path) {
            (Method::Get, "/") => Reply {
                status: 200,
                content_type: "text/html; charset=utf-8",
                body: PAGE.into(),
            },
            (Method::Post, "/api/login") => self.login(ip, body),
            (Method::Get, "/api/state") if self.authorized(bearer) => self.state(query),
            (Method::Post, "/api/command") if self.authorized(bearer) => self.command(body),
            (_, "/api/state" | "/api/command") => Reply::empty(401),
            _ => Reply::empty(404),
        }
    }

    fn authorized(&self, bearer: Option<&str>) -> bool {
        bearer == Some(self.config.lock().unwrap().token.as_str())
    }

    fn login(&self, ip: IpAddr, body: &str) -> Reply {
        // El lock se mantiene toda la función: con intentos en paralelo no se
        // puede esquivar el límite.
        let mut fails = self.fails.lock().unwrap();
        if let Some((count, since)) = fails.get(&ip).copied() {
            if since.elapsed() >= LOCKOUT {
                fails.remove(&ip);
            } else if count >= MAX_FAILS {
                return Reply::empty(429);
            }
        }

        let request: Value = serde_json::from_str(body).unwrap_or(Value::Null);
        let config = self.config.lock().unwrap();
        if request["pin"].as_str() == Some(config.pin.as_str()) {
            fails.remove(&ip);
            return Reply::json(200, json!({ "token": config.token }).to_string());
        }
        let entry = fails.entry(ip).or_insert((0, Instant::now()));
        *entry = (entry.0 + 1, Instant::now());
        Reply::empty(401)
    }

    /// 204 si el celular ya tiene la última versión.
    fn state(&self, query: &str) -> Reply {
        let snapshot = self.snapshot.lock().unwrap();
        if query.strip_prefix("v=").and_then(|v| v.parse().ok()) == Some(snapshot.0) {
            return Reply::empty(204);
        }
        // `now` deja que el celular calcule tiempos aunque su reloj difiera.
        Reply::json(
            200,
            format!(r#"{{"now":{},"version":{},"state":{}}}"#, unix_millis(), snapshot.0, snapshot.1),
        )
    }

    fn command(&self, body: &str) -> Reply {
        let Ok(command) = serde_json::from_str::<Value>(body) else {
            return Reply::empty(400);
        };
        match self.sink.lock().unwrap().as_ref() {
            Some(sink) => {
                sink(command);
                Reply::empty(204)
            }
            None => Reply::empty(503),
        }
    }
}

struct Running {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
    #[cfg(test)]
    address: SocketAddr,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

fn serve(hub: Arc<Hub>, address: SocketAddr) -> Result<Running, String> {
    let server = Arc::new(
        Server::http(address).map_err(|e| format!("No se pudo abrir el puerto {}: {e}", address.port()))?,
    );
    #[cfg(test)]
    let address = server.server_addr().to_ip().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let threads = (0..WORKERS)
        .map(|_| {
            let (hub, server, stop) = (hub.clone(), server.clone(), stop.clone());
            thread::spawn(move || {
                while !stop.load(Ordering::SeqCst) {
                    if let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(250)) {
                        respond(&hub, request);
                    }
                }
            })
        })
        .collect();
    Ok(Running {
        stop,
        threads,
        #[cfg(test)]
        address,
    })
}

fn respond(hub: &Hub, mut request: Request) {
    let ip = request.remote_addr().map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |a| a.ip());
    let bearer = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .and_then(|h| h.value.as_str().strip_prefix("Bearer ").map(str::to_owned));

    let mut body = String::new();
    let read = request.as_reader().take(MAX_BODY + 1).read_to_string(&mut body);
    let reply = if read.is_err() {
        Reply::empty(400)
    } else if body.len() as u64 > MAX_BODY {
        Reply::empty(413)
    } else {
        hub.handle(request.method(), request.url(), bearer.as_deref(), ip, &body)
    };

    let mut response = Response::from_string(reply.body).with_status_code(reply.status);
    for (name, value) in [
        ("Content-Type", reply.content_type),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        (
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:",
        ),
    ] {
        response.add_header(Header::from_bytes(name, value).expect("header fijo válido"));
    }
    let _ = request.respond(response);
}

// ---------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------

pub struct RemoteState {
    hub: Arc<Hub>,
    config_path: PathBuf,
    running: Mutex<Option<Running>>,
    error: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    running: bool,
    pin: String,
    error: Option<String>,
    addresses: Vec<Address>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Address {
    url: String,
    /// QR de la dirección con el PIN: escanearlo entra directo.
    qr_size: i32,
    qr_path: String,
}

impl RemoteState {
    pub fn load(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app.path().app_data_dir()?;
        fs::create_dir_all(&dir)?;
        let config_path = dir.join("remote.json");
        let config = fs::read_to_string(&config_path)
            .ok()
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_else(|| Config::generate(false));
        Ok(Self {
            hub: Arc::new(Hub::new(config)),
            config_path,
            running: Mutex::new(None),
            error: Mutex::new(None),
        })
    }

    fn save_config(&self) -> Result<(), String> {
        let json = serde_json::to_string(&*self.hub.config.lock().unwrap()).map_err(|e| e.to_string())?;
        write_atomic(&self.config_path, &json).map_err(|e| e.to_string())
    }

    /// Pone el servidor como diga la configuración.
    fn apply(&self) {
        let enabled = self.hub.config.lock().unwrap().enabled;
        let mut running = self.running.lock().unwrap();
        let mut error = self.error.lock().unwrap();
        if !enabled {
            *running = None;
            *error = None;
        } else if running.is_none() {
            // LUMENPRO_REMOTE_HOST: para probar sin exponer nada a la red.
            let host = std::env::var("LUMENPRO_REMOTE_HOST")
                .ok()
                .and_then(|h| h.parse().ok())
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));
            match serve(self.hub.clone(), SocketAddr::new(host, PORT)) {
                Ok(server) => {
                    *running = Some(server);
                    *error = None;
                }
                Err(e) => *error = Some(e),
            }
        }
    }

    fn status(&self) -> RemoteStatus {
        let pin = self.hub.config.lock().unwrap().pin.clone();
        RemoteStatus {
            running: self.running.lock().unwrap().is_some(),
            error: self.error.lock().unwrap().clone(),
            addresses: local_ipv4().into_iter().map(|ip| address(ip, &pin)).collect(),
            pin,
        }
    }
}

fn address(ip: Ipv4Addr, pin: &str) -> Address {
    let url = format!("http://{ip}:{PORT}");
    let qr = QrCode::encode_text(&format!("{url}/#{pin}"), QrCodeEcc::Medium).expect("una URL corta entra en un QR");
    let mut qr_path = String::new();
    for y in 0..qr.size() {
        for x in 0..qr.size() {
            if qr.get_module(x, y) {
                qr_path.push_str(&format!("M{x},{y}h1v1h-1z"));
            }
        }
    }
    Address { url, qr_size: qr.size(), qr_path }
}

/// Direcciones de esta PC en la red, primero la de la ruta por defecto (con
/// adaptadores virtuales de por medio suele ser la que sirve).
fn local_ipv4() -> Vec<Ipv4Addr> {
    // connect() en UDP no envía nada: solo pregunta por qué interfaz saldría.
    let preferred = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))
        .and_then(|s| s.connect((Ipv4Addr::new(8, 8, 8, 8), 80)).map(|_| s))
        .and_then(|s| s.local_addr())
        .ok()
        .map(|a| a.ip());
    let mut ips: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_link_local() => Some(ip),
            _ => None,
        })
        .collect();
    ips.sort_by_key(|ip| Some(IpAddr::V4(*ip)) != preferred);
    ips
}

/// Conecta el frontend: por `on_command` le llegan las órdenes del celular.
#[tauri::command(async)]
pub fn remote_attach(state: State<'_, RemoteState>, on_command: Channel<Value>) -> RemoteStatus {
    *state.hub.sink.lock().unwrap() = Some(Box::new(move |command| {
        let _ = on_command.send(command);
    }));
    state.apply();
    state.status()
}

#[tauri::command(async)]
pub fn remote_status(state: State<'_, RemoteState>) -> RemoteStatus {
    state.status()
}

#[tauri::command(async)]
pub fn remote_set_enabled(state: State<'_, RemoteState>, enabled: bool) -> Result<RemoteStatus, String> {
    state.hub.config.lock().unwrap().enabled = enabled;
    state.save_config()?;
    state.apply();
    Ok(state.status())
}

/// PIN y token nuevos: desconecta a todos los celulares.
#[tauri::command(async)]
pub fn remote_new_pin(state: State<'_, RemoteState>) -> Result<RemoteStatus, String> {
    {
        let mut config = state.hub.config.lock().unwrap();
        *config = Config::generate(config.enabled);
    }
    state.save_config()?;
    Ok(state.status())
}

#[tauri::command]
pub fn remote_publish(state: State<'_, RemoteState>, snapshot: String) {
    state.hub.publish(snapshot);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;

    const IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50));
    const OTHER_IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 51));

    fn hub() -> Hub {
        Hub::new(Config { enabled: true, pin: "123456".into(), token: "tok".into() })
    }

    fn login(hub: &Hub, ip: IpAddr, pin: &str) -> Reply {
        hub.handle(&Method::Post, "/api/login", None, ip, &format!(r#"{{"pin":"{pin}"}}"#))
    }

    #[test]
    fn pin_gives_the_token_and_nothing_works_without_it() {
        let hub = hub();
        let reply = login(&hub, IP, "123456");
        assert_eq!((reply.status, reply.body.as_str()), (200, r#"{"token":"tok"}"#));

        for bearer in [None, Some(""), Some("otro"), Some("123456")] {
            assert_eq!(hub.handle(&Method::Get, "/api/state", bearer, IP, "").status, 401);
            assert_eq!(hub.handle(&Method::Post, "/api/command", bearer, IP, "{}").status, 401);
        }
        assert_eq!(hub.handle(&Method::Get, "/api/state", Some("tok"), IP, "").status, 200);
    }

    #[test]
    fn malformed_logins_are_rejected() {
        let hub = hub();
        for body in ["", "x", "{}", r#"{"pin":123456}"#, r#"{"pin":null}"#] {
            assert_eq!(hub.handle(&Method::Post, "/api/login", None, OTHER_IP, body).status, 401, "{body}");
        }
    }

    #[test]
    fn five_wrong_pins_lock_that_phone_only_even_with_the_right_pin() {
        let hub = hub();
        for _ in 0..MAX_FAILS {
            assert_eq!(login(&hub, IP, "000000").status, 401);
        }
        assert_eq!(login(&hub, IP, "123456").status, 429);
        assert_eq!(login(&hub, OTHER_IP, "123456").status, 200);
    }

    #[test]
    fn lockout_expires() {
        let hub = hub();
        let long_ago = Instant::now().checked_sub(LOCKOUT).expect("la PC lleva más de un minuto encendida");
        hub.fails.lock().unwrap().insert(IP, (MAX_FAILS, long_ago));
        assert_eq!(login(&hub, IP, "123456").status, 200);
    }

    #[test]
    fn state_is_sent_once_per_version() {
        let hub = hub();
        hub.publish(r#"{"a":1}"#.into());
        let reply: Value =
            serde_json::from_str(&hub.handle(&Method::Get, "/api/state?v=1", Some("tok"), IP, "").body).unwrap();
        assert_eq!(reply["state"]["a"], 1);
        let seen = format!("/api/state?v={}", reply["version"]);
        assert_eq!(hub.handle(&Method::Get, &seen, Some("tok"), IP, "").status, 204);
        hub.publish(r#"{"a":2}"#.into());
        assert_eq!(hub.handle(&Method::Get, &seen, Some("tok"), IP, "").status, 200);
    }

    #[test]
    fn commands_reach_the_frontend_and_fail_loudly_if_it_is_not_there() {
        let hub = hub();
        let send = |body| hub.handle(&Method::Post, "/api/command", Some("tok"), IP, body).status;
        assert_eq!(send(r#"{"type":"next"}"#), 503);

        let received = Arc::new(Mutex::new(Vec::new()));
        let for_sink = received.clone();
        *hub.sink.lock().unwrap() = Some(Box::new(move |c| for_sink.lock().unwrap().push(c)));
        assert_eq!(send(r#"{"type":"next"}"#), 204);
        assert_eq!(send("no es json"), 400);
        assert_eq!(*received.lock().unwrap(), vec![json!({ "type": "next" })]);
    }

    #[test]
    fn generated_pins_have_six_digits_and_change() {
        let (a, b) = (Config::generate(true), Config::generate(true));
        assert!(a.pin.len() == 6 && a.pin.chars().all(|c| c.is_ascii_digit()));
        assert_eq!(a.token.len(), 32);
        assert_ne!(a.token, b.token);
    }

    /// Petición HTTP de verdad, por la red local de la propia PC.
    fn http(address: SocketAddr, request: &str) -> String {
        let mut stream = TcpStream::connect(address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        stream.write_all(request.as_bytes()).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        reply
    }

    fn post(path: &str, extra: &str, body: &str) -> String {
        format!(
            "POST {path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n{extra}Content-Length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn real_server_serves_the_page_logs_in_and_relays_commands() {
        let hub = Arc::new(hub());
        let received = Arc::new(Mutex::new(Vec::new()));
        let for_sink = received.clone();
        *hub.sink.lock().unwrap() = Some(Box::new(move |c| for_sink.lock().unwrap().push(c)));
        let running = serve(hub, (Ipv4Addr::LOCALHOST, 0).into()).unwrap();
        let at = running.address;

        let page = http(at, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("LUMEN PRO"));
        assert!(page.contains("Content-Security-Policy"));

        assert!(http(at, &post("/api/login", "", r#"{"pin":"123456"}"#)).contains(r#"{"token":"tok"}"#));
        assert!(http(at, &post("/api/command", "", "{}")).starts_with("HTTP/1.1 401"));
        let auth = "Authorization: Bearer tok\r\n";
        assert!(http(at, &post("/api/command", auth, r#"{"type":"next"}"#)).starts_with("HTTP/1.1 204"));
        assert!(http(at, &post("/api/command", auth, &"x".repeat(5000))).starts_with("HTTP/1.1 413"));
        assert_eq!(received.lock().unwrap().len(), 1);

        // Al apagarlo se libera el puerto: si no, no se podría volver a encender.
        drop(running);
        let mut reopened = Err(String::new());
        for _ in 0..20 {
            reopened = serve(Arc::new(self::hub()), at);
            if reopened.is_ok() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        assert!(reopened.is_ok(), "{:?}", reopened.err());
    }

    #[test]
    fn busy_port_is_an_error_not_a_panic() {
        let first = serve(Arc::new(hub()), (Ipv4Addr::LOCALHOST, 0).into()).unwrap();
        assert!(serve(Arc::new(hub()), first.address).is_err());
    }
}
