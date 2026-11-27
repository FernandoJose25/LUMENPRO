//! El reproductor de enlaces en Brave (ver links.rs): Brave bloquea los
//! anuncios de YouTube. LUMEN abre su propio Brave, con un perfil aparte en la
//! carpeta del programa (no toca el del usuario), y lo maneja por el protocolo
//! de depuración de Chromium (CDP), solo desde esta PC.

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// Dónde está Brave, si está instalado.
pub fn find() -> Option<PathBuf> {
    const EXE: &str = r"BraveSoftware\Brave-Browser\Application\brave.exe";
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| Path::new(&base).join(EXE))
        .find(|path| path.is_file())
}

pub enum Fail {
    /// Brave se cerró (o lo cerraron).
    Closed,
    /// La página no pudo contestar (por ejemplo, mientras cambia de video).
    Other(String),
}

pub struct Brave {
    child: Child,
    socket: WebSocket<MaybeTlsStream<TcpStream>>,
    /// La ventana de Brave, dentro de la conexión con todo el navegador.
    session: String,
    next_id: u64,
}

impl Brave {
    /// Abre Brave en blanco con `script` en cada página que cargue.
    pub fn open(exe: &Path, profile: &Path, script: &str) -> Result<Self, String> {
        let port_file = profile.join("DevToolsActivePort");
        let _ = std::fs::remove_file(&port_file);
        let mut child = Command::new(exe)
            .arg(format!("--user-data-dir={}", profile.display()))
            .args([
                "--remote-debugging-port=0",
                "--no-first-run",
                "--no-default-browser-check",
                "--autoplay-policy=no-user-gesture-required",
                // Tapado por LUMEN sigue igual que al frente: sin esto frena los
                // relojes de la página y puede pausar el video.
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--window-size=960,600",
                "--app=about:blank",
            ])
            .spawn()
            .map_err(|e| format!("No se pudo abrir Brave: {e}"))?;

        // Brave anota en el perfil en qué puerto escucha.
        let started = Instant::now();
        let (port, path) = loop {
            let text = std::fs::read_to_string(&port_file).unwrap_or_default();
            let mut lines = text.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                break (port.trim().to_string(), path.trim().to_string());
            }
            if started.elapsed() > Duration::from_secs(20) || !matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
                return Err("Brave no respondió. Ciérralo y vuelve a probar.".into());
            }
            thread::sleep(Duration::from_millis(200));
        };
        let (socket, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}{path}")).map_err(|e| {
            let _ = child.kill();
            format!("No pude hablar con Brave: {e}")
        })?;
        if let MaybeTlsStream::Plain(tcp) = socket.get_ref() {
            let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
        }
        let mut brave = Brave { child, socket, session: String::new(), next_id: 0 };
        let ready = (|| -> Result<(), Fail> {
            let targets = brave.call("Target.getTargets", json!({}), false)?;
            let page = targets["targetInfos"]
                .as_array()
                .and_then(|list| list.iter().find(|t| t["type"] == "page"))
                .and_then(|t| t["targetId"].as_str())
                .ok_or(Fail::Other("Brave no abrió la ventana".into()))?
                .to_string();
            let attached = brave.call("Target.attachToTarget", json!({ "targetId": page, "flatten": true }), false)?;
            brave.session = attached["sessionId"].as_str().unwrap_or_default().to_string();
            // Sin Page.enable, Brave no pone el script en las páginas nuevas.
            brave.call("Page.enable", json!({}), true)?;
            brave.call("Page.addScriptToEvaluateOnNewDocument", json!({ "source": script }), true)?;
            Ok(())
        })();
        match ready {
            Ok(()) => Ok(brave),
            Err(fail) => {
                brave.close();
                Err(match fail {
                    Fail::Closed => "Brave se cerró al abrir".into(),
                    Fail::Other(e) => e,
                })
            }
        }
    }

    /// Manda una orden y espera su respuesta (lo demás que llega se ignora).
    fn call(&mut self, method: &str, params: Value, in_page: bool) -> Result<Value, Fail> {
        self.next_id += 1;
        let id = self.next_id;
        let mut order = json!({ "id": id, "method": method, "params": params });
        if in_page {
            order["sessionId"] = json!(self.session);
        }
        self.socket.send(Message::text(order.to_string())).map_err(|_| Fail::Closed)?;
        loop {
            let reply = match self.socket.read() {
                Ok(Message::Text(text)) => text,
                Ok(Message::Close(_)) => return Err(Fail::Closed),
                Ok(_) => continue,
                Err(tungstenite::Error::Io(e))
                    if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) =>
                {
                    return Err(Fail::Other("Brave tardó en contestar".into()))
                }
                Err(_) => return Err(Fail::Closed),
            };
            let reply: Value = serde_json::from_str(reply.as_str()).unwrap_or_default();
            if reply["id"] != id {
                continue;
            }
            return match reply.get("error") {
                Some(e) => Err(Fail::Other(e["message"].as_str().unwrap_or("error").to_string())),
                None => Ok(reply["result"].clone()),
            };
        }
    }

    pub fn navigate(&mut self, url: &str) -> Result<(), Fail> {
        self.call("Page.navigate", json!({ "url": url }), true).map(|_| ())
    }

    /// Corre `js` en la página y devuelve su valor.
    pub fn eval(&mut self, js: &str) -> Result<Value, Fail> {
        let r = self.call("Runtime.evaluate", json!({ "expression": js, "returnByValue": true }), true)?;
        Ok(r["result"]["value"].clone())
    }

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    pub fn close(mut self) {
        let _ = self.call("Browser.close", json!({}), false);
        let started = Instant::now();
        while self.alive() && started.elapsed() < Duration::from_secs(3) {
            thread::sleep(Duration::from_millis(100));
        }
        let _ = self.child.kill();
    }
}
