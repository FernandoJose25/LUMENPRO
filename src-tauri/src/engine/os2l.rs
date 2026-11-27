//! VirtualDJ (o cualquier programa de DJ con OS2L) se conecta acá y manda cada
//! golpe y sus botones (`os2l_button "Nombre"`). Se anuncia en la red como
//! `_os2l._tcp` para que VirtualDJ lo encuentre solo; si no, en VirtualDJ se
//! escribe la dirección en la opción `os2lDirectIp` (IP:9996).
//!
//! Los mensajes son objetos JSON pegados uno tras otro, sin separador.

use super::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::thread;
use std::time::Duration;

/// El que usa VirtualDJ en sus ejemplos.
pub const PORT: u16 = 9996;
/// Lo recibido que no cierra nunca un objeto no puede crecer sin fin.
const MAX_PENDING: usize = 64 * 1024;

/// Se recuerda en esta carpeta: apagado hasta que se prende en Audio Reactive.
const CONFIG_FILE: &str = "os2l.json";

#[derive(Default)]
pub struct Os2l {
    clients: AtomicUsize,
    port: Mutex<Option<u16>>,
    error: Mutex<Option<String>>,
    /// Mientras escucha: lo que lo detiene y el anuncio en la red.
    running: Mutex<Option<(Arc<AtomicBool>, Option<mdns_sd::ServiceDaemon>)>>,
    /// El motor, para los hilos de cada conexión.
    pub engine: std::sync::OnceLock<Weak<Engine>>,
}

impl Os2l {
    pub fn status(&self) -> Value {
        json!({
            "enabled": self.running.lock().unwrap().is_some(),
            "port": *self.port.lock().unwrap(),
            "clients": self.clients.load(Ordering::SeqCst),
            "error": self.error.lock().unwrap().clone(),
        })
    }
}

/// Lo que se eligió la última vez.
pub fn was_enabled(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(CONFIG_FILE))
        .ok()
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(|v| v["enabled"].as_bool())
        .unwrap_or(false)
}

/// Prende o apaga (y lo recuerda). `port` 0 = uno libre, solo para pruebas.
pub fn set_enabled(engine: &Engine, enabled: bool, port: u16) -> Result<(), String> {
    let _ = std::fs::write(engine.dir.join(CONFIG_FILE), json!({ "enabled": enabled }).to_string());
    let mut running = engine.os2l.running.lock().unwrap();
    if !enabled {
        if let Some((stop, mdns)) = running.take() {
            stop.store(true, Ordering::SeqCst);
            if let Some(daemon) = mdns {
                let _ = daemon.shutdown();
            }
        }
        *engine.os2l.port.lock().unwrap() = None;
        return Ok(());
    }
    if running.is_some() {
        return Ok(());
    }
    // Puerto 0 es de las pruebas: sin salir a la red (ni aviso del firewall).
    let host = if port == 0 { "127.0.0.1" } else { "0.0.0.0" };
    let listener = TcpListener::bind((host, port)).map_err(|e| {
        let error = format!("No se pudo abrir el puerto {port}: {e}");
        *engine.os2l.error.lock().unwrap() = Some(error.clone());
        error
    })?;
    *engine.os2l.error.lock().unwrap() = None;
    let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
    *engine.os2l.port.lock().unwrap() = Some(bound);
    let stop = Arc::new(AtomicBool::new(false));
    let mdns = if port != 0 { advertise(bound) } else { None };
    *running = Some((stop.clone(), mdns));
    let weak = engine.os2l.engine.get().cloned().unwrap_or_default();
    // Sin bloquear: así se puede apagar.
    let _ = listener.set_nonblocking(true);
    thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let (weak, stop) = (weak.clone(), stop.clone());
                    thread::spawn(move || client(weak, stream, stop));
                }
                Err(_) => thread::sleep(Duration::from_millis(100)),
            }
        }
    });
    Ok(())
}

/// Saca de `buffer` los objetos JSON completos; lo que queda a medias espera
/// al resto. Las llaves dentro de un texto no cuentan.
pub fn split_objects(buffer: &mut String) -> Vec<Value> {
    let mut out = Vec::new();
    loop {
        let Some(start) = buffer.find('{') else {
            buffer.clear();
            break;
        };
        let (mut depth, mut in_text, mut escaped, mut end) = (0, false, false, None);
        for (i, c) in buffer[start..].char_indices() {
            if in_text {
                match c {
                    _ if escaped => escaped = false,
                    '\\' => escaped = true,
                    '"' => in_text = false,
                    _ => {}
                }
                continue;
            }
            match c {
                '"' => in_text = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(start + i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        let Some(end) = end else {
            buffer.drain(..start);
            break;
        };
        if let Ok(value) = serde_json::from_str::<Value>(&buffer[start..end]) {
            out.push(value);
        }
        buffer.drain(..end);
    }
    if buffer.len() > MAX_PENDING {
        buffer.clear();
    }
    out
}

fn client(engine: Weak<Engine>, mut stream: TcpStream, stop: Arc<AtomicBool>) {
    if let Some(e) = engine.upgrade() {
        e.os2l.clients.fetch_add(1, Ordering::SeqCst);
    }
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let mut buffer = String::new();
    let mut chunk = [0u8; 4096];
    while !stop.load(Ordering::SeqCst) {
        let n = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(_) => break,
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk[..n]));
        let messages = split_objects(&mut buffer);
        let Some(e) = engine.upgrade() else { break };
        if messages.is_empty() {
            continue;
        }
        let now = e.clock.now();
        {
            let mut show = e.show.lock().unwrap();
            for message in &messages {
                show.os2l(message, now);
            }
        }
        e.changed.notify_all();
    }
    if let Some(e) = engine.upgrade() {
        e.os2l.clients.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Para que VirtualDJ lo encuentre solo (mDNS, sin instalar Bonjour).
fn advertise(port: u16) -> Option<mdns_sd::ServiceDaemon> {
    let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "lumenpro".into()).to_lowercase();
    let made = mdns_sd::ServiceDaemon::new().and_then(|daemon| {
        let info = mdns_sd::ServiceInfo::new(
            "_os2l._tcp.local.",
            "LUMEN PRO",
            &format!("{host}.local."),
            "",
            port,
            None::<HashMap<String, String>>,
        )?
        .enable_addr_auto();
        daemon.register(info)?;
        Ok(daemon)
    });
    made.map_err(|e| eprintln!("OS2L: no se pudo anunciar en la red: {e}")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_glued_together_or_cut_in_half_are_read_whole() {
        let mut buffer = String::from(r#"{"evt":"beat","pos":1,"bpm":120}{"evt":"btn","name":"a}{b","state":"on"} {"evt":"be"#);
        let first = split_objects(&mut buffer);
        assert_eq!(first.len(), 2);
        assert_eq!(first[1]["name"], "a}{b");
        assert_eq!(buffer, r#"{"evt":"be"#);
        buffer.push_str(r#"at","pos":2,"bpm":120}"#);
        assert_eq!(split_objects(&mut buffer)[0]["pos"], 2);
        assert!(buffer.is_empty());
        // Basura entre medio no traba nada.
        let mut junk = String::from("hola {\"evt\":\"beat\",\"pos\":3,\"bpm\":90}");
        assert_eq!(split_objects(&mut junk)[0]["pos"], 3);
    }
}
