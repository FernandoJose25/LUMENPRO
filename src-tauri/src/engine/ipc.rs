//! Servidor del motor: TCP solo en 127.0.0.1, con una clave que está en un
//! archivo del usuario. Una línea JSON por pedido y una por respuesta.

use super::{Engine, Request};
use crate::show::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const FILE: &str = "engine.json";
/// Un show grande son cientos de KB; esto es solo para no llenar la memoria.
const MAX_LINE: u64 = 64 * 1024 * 1024;

/// Dónde está el motor. Se escribe al arrancar y lo lee la ventana.
#[derive(Serialize, Deserialize)]
struct Door {
    port: u16,
    token: String,
}

pub fn serve(engine: Arc<Engine>) -> std::io::Result<()> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(std::io::Error::other)?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let door = Door { port: listener.local_addr()?.port(), token: token.clone() };
    write_atomic(&engine.dir.join(FILE), &serde_json::to_string(&door)?)?;

    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (engine, token) = (engine.clone(), token.clone());
            thread::spawn(move || talk(&engine, &token, stream));
        }
    });
    Ok(())
}

fn read_line(reader: &mut BufReader<TcpStream>) -> Option<String> {
    let mut line = String::new();
    let read = reader.by_ref().take(MAX_LINE).read_line(&mut line).ok()?;
    (read > 0 && line.ends_with('\n')).then_some(line)
}

/// Resta la conexión aunque el hilo termine mal.
struct UiConnection<'a>(&'a Engine);

impl<'a> UiConnection<'a> {
    fn new(engine: &'a Engine) -> Self {
        engine.ui.lock().unwrap().connections += 1;
        Self(engine)
    }
}

impl Drop for UiConnection<'_> {
    fn drop(&mut self) {
        self.0.ui.lock().unwrap().connections -= 1;
    }
}

fn talk(engine: &Engine, token: &str, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let Ok(mut writer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(stream);

    // Saludo: la clave, y si quien habla es la ventana.
    let Some(hello) = read_line(&mut reader) else { return };
    let hello: Value = serde_json::from_str(&hello).unwrap_or(Value::Null);
    if hello["token"] != token {
        return;
    }
    let _connection = (hello["ui"] == true).then(|| UiConnection::new(engine));

    while let Some(line) = read_line(&mut reader) {
        let reply = serde_json::from_str::<Request>(&line)
            .map_err(|e| e.to_string())
            .and_then(|request| engine.handle(request));
        let reply = match reply {
            Ok(ok) => json!({ "ok": ok }),
            Err(error) => json!({ "error": error }),
        };
        if writer.write_all(format!("{reply}\n").as_bytes()).is_err() {
            return;
        }
    }
}

/// Lado de la ventana.
pub struct Client {
    reader: BufReader<TcpStream>,
    writer: TcpStream,
}

impl Client {
    /// `None` si no hay un motor atendiendo.
    pub fn connect(dir: &Path, ui: bool) -> Option<Self> {
        let door: Door = serde_json::from_str(&fs::read_to_string(dir.join(FILE)).ok()?).ok()?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, door.port));
        let stream = TcpStream::connect_timeout(&address, Duration::from_millis(500)).ok()?;
        let _ = stream.set_nodelay(true);
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
        let mut client = Self { writer: stream.try_clone().ok()?, reader: BufReader::new(stream) };
        client.write(&json!({ "token": door.token, "ui": ui }).to_string()).ok()?;
        // Otro programa pudo quedarse con el puerto de un motor que ya no está.
        client.ask(r#"{"cmd":"live"}"#).ok()?;
        Some(client)
    }

    fn write(&mut self, line: &str) -> std::io::Result<()> {
        self.writer.write_all(format!("{line}\n").as_bytes())
    }

    /// Manda un pedido (una línea JSON) y devuelve la respuesta tal cual.
    pub fn ask(&mut self, request: &str) -> std::io::Result<String> {
        self.write(request)?;
        read_line(&mut self.reader).ok_or_else(|| std::io::ErrorKind::ConnectionAborted.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn engine(name: &str) -> Arc<Engine> {
        let dir = std::env::temp_dir().join(format!("lumenpro-ipc-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        Engine::new(&dir)
    }

    #[test]
    fn a_window_connects_asks_and_its_death_is_noticed() {
        let engine = engine("ask");
        serve(engine.clone()).unwrap();
        let mut client = Client::connect(&engine.dir, true).unwrap();
        assert_eq!(client.ask(r#"{"cmd":"live"}"#).unwrap().trim(), r#"{"ok":false}"#);
        assert!(client.ask(r#"{"cmd":"nada"}"#).unwrap().contains("error"));
        assert!(client.ask("basura").unwrap().contains("error"));
        assert_eq!(engine.ui.lock().unwrap().connections, 1);
        drop(client);
        let limit = Instant::now() + Duration::from_secs(2);
        while engine.ui.lock().unwrap().connections > 0 && Instant::now() < limit {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(engine.ui.lock().unwrap().connections, 0);
    }

    #[test]
    fn without_the_key_nothing_is_answered() {
        let engine = engine("key");
        serve(engine.clone()).unwrap();
        let door: Door = serde_json::from_str(&fs::read_to_string(engine.dir.join(FILE)).unwrap()).unwrap();
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, door.port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        stream.write_all(b"{\"token\":\"otra\"}\n{\"cmd\":\"live\"}\n").unwrap();
        let mut reply = String::new();
        let _ = stream.read_to_string(&mut reply);
        assert_eq!(reply, "");
    }

    #[test]
    fn no_engine_is_not_an_error() {
        let engine = engine("none");
        assert!(Client::connect(&engine.dir, true).is_none());
    }
}
