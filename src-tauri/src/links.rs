//! Enlaces de YouTube y Spotify en Música (src/lib/links.ts). Todo suena desde
//! YouTube en la ventana "reproductor" de LUMEN: de un enlace de Spotify se
//! leen los nombres de las canciones y se buscan en YouTube. No se descarga
//! nada. Las luces lo siguen con "Lo que suena en esta PC" (pc_audio.rs).
//!
//! Si Brave está instalado, suena en Brave (brave.rs): bloquea los anuncios.
//! Si no, en la ventana "reproductor" de LUMEN, que carga páginas de internet
//! sin acceso a los comandos de LUMEN y avisa cambiando su título
//! (`on_document_title_changed`).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use crate::brave::{self, Brave, Fail};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

/// El Brave que hace de reproductor, si está abierto.
static BRAVE: Mutex<Option<Brave>> = Mutex::new(None);
/// Cada Brave tiene quien lo vigile (`watch`); al abrir otro, el anterior se retira.
static WATCH: AtomicU64 = AtomicU64::new(0);

const PAUSE_JS: &str = "document.querySelector('#movie_player video')?.pause()";
const PLAY_JS: &str = "document.querySelector('#movie_player video')?.play()";
const NEXT_JS: &str = "document.querySelector('.ytp-next-button')?.click()";

const MAIN: &str = "main";
const PLAYER: &str = "reproductor";
/// Título que pone la página cuando termina un video (ver PLAYER_SCRIPT).
const ENDED: &str = "LUMEN:fin";

/// Por dónde le llegan a la ventana principal el título y el fin de cada canción.
static EVENTS: Mutex<Option<Channel<Value>>> = Mutex::new(None);

fn tell(event: Value) {
    if let Some(channel) = EVENTS.lock().unwrap().as_ref() {
        let _ = channel.send(event);
    }
}

/// Corre en cada página de YouTube del reproductor.
const PLAYER_SCRIPT: &str = r##"(() => {
  if (window.__lumen) return;
  window.__lumen = true;
  // LUMEN marca con lumen=1 la página que abre; YouTube lo borra de la
  // dirección apenas carga, así que se lee al empezar.
  let pending = new URLSearchParams(location.search).has("lumen");
  let watched = null, done = "", last = -1, stuck = 0;
  // En una playlist de YouTube sigue YouTube; si no, LUMEN pasa a la siguiente.
  const finish = () => {
    const ad = document.querySelector("#movie_player.ad-showing");
    if (location.pathname !== "/watch" || ad || done === location.href) return;
    if (new URLSearchParams(location.search).has("list")) return;
    done = location.href;
    window.__lumenEnded = Date.now();
    document.title = "LUMEN:fin";
  };
  setInterval(() => {
    const path = location.pathname;
    // Una canción de Spotify: el primer video de la búsqueda, solo (sin el "Mix").
    // YouTube arma los resultados de dos formas distintas: vale el primer enlace a un video.
    if (pending && path === "/results") {
      const first = document.querySelector('ytd-search a[href*="/watch?v="]');
      const v = first && new URL(first.href).searchParams.get("v");
      if (v) { pending = false; location.replace("/watch?v=" + v); }
    }
    // Una playlist: "Reproducir todo".
    if (pending && path === "/playlist") {
      const all = document.querySelector('a[href*="/watch?"][href*="list="]');
      if (all) { pending = false; location.replace(all.href); }
    }
    const video = path === "/watch" ? document.querySelector("#movie_player video") : null;
    if (video && video !== watched) {
      watched = video;
      video.addEventListener("ended", finish);
    }
    // Por si el aviso del video no llega, o se traba en los últimos segundos
    // (YouTube a veces no carga el final): 3 s quieto al final cuenta como terminado.
    if (video && video.ended) finish();
    const atEnd = video && !video.paused && video.duration > 0 && video.duration - video.currentTime < 3;
    stuck = atEnd && video.currentTime === last ? stuck + 1 : 0;
    last = video ? video.currentTime : -1;
    if (stuck >= 8) finish();
  }, 400);
})();"##;

/// El título de YouTube sin "(3) " adelante ni " - YouTube" atrás.
fn song_title(title: &str) -> Option<String> {
    let t = title.trim();
    let t = match t.strip_prefix('(').and_then(|r| r.split_once(") ")) {
        Some((n, rest)) if n.chars().all(|c| c.is_ascii_digit()) => rest,
        _ => t,
    };
    let t = t.strip_suffix(" - YouTube").unwrap_or(t).trim();
    (!t.is_empty() && t != "YouTube" && !t.starts_with("LUMEN:")).then(|| t.to_string())
}

fn youtube_host(host: &str) -> bool {
    matches!(host, "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be")
}

/// Solo YouTube y el inicio de sesión de Google: un enlace a otra página no se abre aquí.
fn allowed(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "about"
        || (url.scheme() == "https"
            && [".youtube.com", ".google.com", ".youtu.be"]
                .iter()
                .any(|d| host.ends_with(d) || host == &d[1..]))
}

#[derive(Serialize)]
pub struct LinkInfo {
    /// None si no se pudo leer (sin internet): la ventana pone un nombre genérico.
    title: Option<String>,
    /// Solo Spotify: "artista canción" de cada una, para buscarlas en YouTube.
    tracks: Vec<String>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_text(url: Url) -> Result<String, String> {
    let response = client()?.get(url).send().await.map_err(|_| "Sin conexión a internet".to_string())?;
    if !response.status().is_success() {
        return Err(format!("respondió {}", response.status()));
    }
    response.text().await.map_err(|e| e.to_string())
}

/// El nombre del enlace y, si es de Spotify, sus canciones.
#[tauri::command]
pub async fn link_info(url: String) -> Result<LinkInfo, String> {
    let parsed = Url::parse(&url).map_err(|_| "Ese enlace no se entiende".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    if youtube_host(host) {
        let api = Url::parse_with_params("https://www.youtube.com/oembed", &[("format", "json"), ("url", url.as_str())])
            .map_err(|e| e.to_string())?;
        let title = match get_text(api).await {
            Ok(body) => serde_json::from_str::<Value>(&body).ok().and_then(|v| v["title"].as_str().map(str::to_string)),
            Err(_) => None,
        };
        return Ok(LinkInfo { title, tracks: Vec::new() });
    }
    if host != "open.spotify.com" {
        return Err("Solo enlaces de YouTube o de Spotify".into());
    }
    let mut parts = parsed.path_segments().into_iter().flatten().filter(|s| !s.starts_with("intl-"));
    let (Some(kind @ ("track" | "album" | "playlist")), Some(id)) = (parts.next(), parts.next()) else {
        return Err("De Spotify sirven enlaces de canciones, álbumes o playlists".into());
    };
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Ese enlace de Spotify está incompleto".into());
    }
    let embed = Url::parse(&format!("https://open.spotify.com/embed/{kind}/{id}")).map_err(|e| e.to_string())?;
    let page = get_text(embed).await.map_err(|e| format!("No pude leer el enlace de Spotify: {e}"))?;
    let entity = spotify_entity(&page).ok_or("Spotify no mostró las canciones (¿la playlist es privada?)")?;
    let artists = |v: &Value| -> String {
        v["artists"].as_array().map_or_else(
            || v["subtitle"].as_str().unwrap_or_default().to_string(),
            |a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", "),
        )
    };
    let search = |v: &Value| format!("{} {}", artists(v), v["title"].as_str().unwrap_or_default()).replace('\u{a0}', " ").trim().to_string();
    let tracks: Vec<String> = match entity["trackList"].as_array() {
        Some(list) => list.iter().map(search).filter(|s| !s.is_empty()).collect(),
        None => vec![search(&entity)],
    };
    if tracks.is_empty() {
        return Err("Ese enlace de Spotify no tiene canciones".into());
    }
    let title = entity["name"].as_str().or(entity["title"].as_str()).map(str::to_string);
    Ok(LinkInfo { title, tracks })
}

/// Los datos que la página para insertar de Spotify trae escritos adentro.
fn spotify_entity(page: &str) -> Option<Value> {
    const START: &str = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let rest = &page[page.find(START)? + START.len()..];
    let data: Value = serde_json::from_str(&rest[..rest.find("</script>")?]).ok()?;
    let entity = data.pointer("/props/pageProps/state/data/entity")?;
    entity.is_object().then(|| entity.clone())
}

/// La ventana principal recibe aquí `{title}`, `{ended: true}` y `{closed: true}`.
#[tauri::command]
pub fn player_attach(on_event: Channel<Value>) {
    *EVENTS.lock().unwrap() = Some(on_event);
}

/// Pone una página de YouTube en el reproductor; lo abre si está cerrado.
/// `async`: crear una ventana desde el hilo principal se bloquea en Windows.
#[tauri::command(async)]
pub fn player_play(app: AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|_| "Ese enlace no se entiende".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("www.youtube.com") {
        return Err("El reproductor solo abre YouTube".into());
    }
    if let Some(exe) = brave::find() {
        return play_in_brave(&app, &exe, url.as_str());
    }
    if let Some(open) = app.get_webview_window(PLAYER) {
        return open.navigate(url).map_err(|e| e.to_string());
    }
    let mut builder = WebviewWindowBuilder::new(&app, PLAYER, WebviewUrl::External(url))
        .title("LUMEN PRO — Reproductor")
        .data_directory(app.state::<crate::WebviewDir>().0.clone())
        .inner_size(960.0, 600.0)
        .initialization_script(PLAYER_SCRIPT)
        .on_navigation(allowed)
        .on_document_title_changed(|_, title| {
            if title == ENDED {
                tell(json!({ "ended": true }));
            } else if let Some(title) = song_title(&title) {
                tell(json!({ "title": title }));
            }
        });
    // WebView2 no abre una segunda ventana si los argumentos no son idénticos
    // a los de la primera (también trae el permiso de sonar sin un clic).
    let config = app.config();
    if let Some(args) = config.app.windows.first().and_then(|w| w.additional_browser_args.as_deref()) {
        builder = builder.additional_browser_args(args);
    }
    let window = builder.build().map_err(|e| format!("No se pudo abrir el reproductor: {e}"))?;
    window.on_window_event(|event| {
        if matches!(event, WindowEvent::Destroyed) {
            tell(json!({ "closed": true }));
        }
    });
    Ok(())
}

fn play_in_brave(app: &AppHandle, exe: &Path, url: &str) -> Result<(), String> {
    let mut open = BRAVE.lock().unwrap();
    let reused = match open.as_mut() {
        Some(player) => player.alive() && player.navigate(url).is_ok(),
        None => false,
    };
    if reused {
        return Ok(());
    }
    WATCH.fetch_add(1, Ordering::SeqCst);
    if let Some(old) = open.take() {
        old.close();
    }
    let profile = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("brave-reproductor");
    let mut player = Brave::open(exe, &profile, PLAYER_SCRIPT)?;
    if player.navigate(url).is_err() {
        player.close();
        return Err("Brave no abrió el video".into());
    }
    *open = Some(player);
    let turn = WATCH.fetch_add(1, Ordering::SeqCst) + 1;
    thread::spawn(move || watch(turn));
    Ok(())
}

/// Cada medio segundo mira en Brave el título y si terminó el video; avisa si se cerró.
fn watch(turn: u64) {
    let (mut title, mut ended) = (String::new(), Value::Null);
    loop {
        thread::sleep(Duration::from_millis(500));
        let mut open = BRAVE.lock().unwrap();
        if WATCH.load(Ordering::SeqCst) != turn {
            return;
        }
        let Some(player) = open.as_mut() else { return };
        match player.eval("[document.title, window.__lumenEnded || 0]") {
            Ok(now) => {
                drop(open);
                if now[1] != ended {
                    if !ended.is_null() && now[1] != 0 {
                        tell(json!({ "ended": true }));
                    }
                    ended = now[1].clone();
                }
                let now_title = now[0].as_str().unwrap_or_default();
                if now_title != title {
                    title = now_title.to_string();
                    if let Some(song) = song_title(&title) {
                        tell(json!({ "title": song }));
                    }
                }
            }
            Err(Fail::Other(_)) if player.alive() => {}
            Err(_) => {
                if let Some(gone) = open.take() {
                    gone.close();
                }
                drop(open);
                tell(json!({ "closed": true }));
                return;
            }
        }
    }
}

/// "pause", "play", "next" (dentro de una playlist de YouTube) o "stop" (cierra el reproductor).
/// `async`: cerrar Brave puede tardar un par de segundos.
#[tauri::command(async)]
pub fn player_control(app: AppHandle, action: String) -> Result<(), String> {
    let js = match action.as_str() {
        "pause" => PAUSE_JS,
        "play" => PLAY_JS,
        "next" => NEXT_JS,
        "stop" => "",
        _ => return Err(format!("No sé hacer «{action}»")),
    };
    let mut open = BRAVE.lock().unwrap();
    if js.is_empty() {
        WATCH.fetch_add(1, Ordering::SeqCst);
        if let Some(player) = open.take() {
            player.close();
        }
    } else if let Some(player) = open.as_mut() {
        return player.eval(js).map(|_| ()).map_err(|_| "Brave no respondió".to_string());
    }
    drop(open);
    let Some(player) = app.get_webview_window(PLAYER) else { return Ok(()) };
    if js.is_empty() { player.destroy() } else { player.eval(js) }.map_err(|e| e.to_string())
}

/// Al cerrar la principal se cierra también: si no, la app seguiría viva
/// (y Brave sonando).
pub fn close_with_main(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN || !matches!(event, WindowEvent::Destroyed) {
        return;
    }
    WATCH.fetch_add(1, Ordering::SeqCst);
    if let Some(player) = BRAVE.lock().unwrap().take() {
        player.close();
    }
    if let Some(player) = window.app_handle().get_webview_window(PLAYER) {
        let _ = player.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpia_el_titulo_de_youtube() {
        assert_eq!(song_title("(3) Karol G - Tusa - YouTube").as_deref(), Some("Karol G - Tusa"));
        assert_eq!(song_title("Bad Bunny (Official) - YouTube").as_deref(), Some("Bad Bunny (Official)"));
        assert_eq!(song_title("YouTube"), None);
        assert_eq!(song_title(ENDED), None);
    }

    #[test]
    fn el_reproductor_no_sale_de_youtube() {
        let ok = |u: &str| allowed(&Url::parse(u).unwrap());
        assert!(ok("https://www.youtube.com/watch?v=abc"));
        assert!(ok("https://accounts.google.com/signin"));
        assert!(!ok("https://evil-youtube.com/"));
        assert!(!ok("http://www.youtube.com/"));
        assert!(!ok("https://example.com/"));
    }

    #[test]
    fn lee_las_canciones_de_spotify() {
        let page = r#"<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"name":"Hora loca","trackList":[{"title":"Tusa","subtitle":"KAROL G, Nicki Minaj"}]}}}}}}</script></html>"#;
        let entity = spotify_entity(page).unwrap();
        assert_eq!(entity["name"], "Hora loca");
        assert_eq!(entity["trackList"][0]["title"], "Tusa");
    }
}
