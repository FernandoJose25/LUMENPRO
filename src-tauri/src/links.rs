//! Enlaces de YouTube y Spotify en Música (src/lib/links.ts). Suenan en una
//! ventana nueva del Brave del usuario (el suyo, con sus bloqueos de anuncios y
//! su cuenta) o, sin Brave, en su navegador. De un enlace de Spotify se leen
//! los nombres de las canciones y se buscan en YouTube al agregarlo. No se
//! descarga nada. Las luces lo siguen con "Lo que suena en esta PC"
//! (pc_audio.rs).

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::Url;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// Lo mismo que manda Chrome: con otro navegador YouTube arma la página distinto.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

fn youtube_host(host: &str) -> bool {
    matches!(host, "youtube.com" | "www.youtube.com" | "m.youtube.com" | "music.youtube.com" | "youtu.be")
}

#[derive(Serialize)]
pub struct LinkInfo {
    /// None si no se pudo leer (sin internet): la ventana pone un nombre genérico.
    title: Option<String>,
    /// Solo Spotify: "artista canción" de cada una.
    tracks: Vec<String>,
    /// Solo Spotify: el video de YouTube de cada canción (None si no se encontró).
    videos: Vec<Option<String>>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

async fn get_text(client: &reqwest::Client, url: Url) -> Result<String, String> {
    let response = client
        .get(url)
        .header("Accept-Language", "es-PE,es;q=0.9")
        .send()
        .await
        .map_err(|_| "Sin conexión a internet".to_string())?;
    if !response.status().is_success() {
        return Err(format!("respondió {}", response.status()));
    }
    response.text().await.map_err(|e| e.to_string())
}

/// El nombre del enlace y, si es de Spotify, sus canciones con su video de YouTube.
#[tauri::command]
pub async fn link_info(url: String) -> Result<LinkInfo, String> {
    let parsed = Url::parse(&url).map_err(|_| "Ese enlace no se entiende".to_string())?;
    let host = parsed.host_str().unwrap_or_default();
    let client = client()?;
    if youtube_host(host) {
        let api = Url::parse_with_params("https://www.youtube.com/oembed", &[("format", "json"), ("url", url.as_str())])
            .map_err(|e| e.to_string())?;
        let title = match get_text(&client, api).await {
            Ok(body) => serde_json::from_str::<Value>(&body).ok().and_then(|v| v["title"].as_str().map(str::to_string)),
            Err(_) => None,
        };
        return Ok(LinkInfo { title, tracks: Vec::new(), videos: Vec::new() });
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
    let page = get_text(&client, embed).await.map_err(|e| format!("No pude leer el enlace de Spotify: {e}"))?;
    let entity = spotify_entity(&page).ok_or("Spotify no mostró las canciones (¿la playlist es privada?)")?;
    let artists = |v: &Value| -> String {
        v["artists"].as_array().map_or_else(
            || v["subtitle"].as_str().unwrap_or_default().to_string(),
            |a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>().join(", "),
        )
    };
    let search = |v: &Value| {
        format!("{} {}", artists(v), v["title"].as_str().unwrap_or_default()).replace('\u{a0}', " ").trim().to_string()
    };
    let tracks: Vec<String> = match entity["trackList"].as_array() {
        Some(list) => list.iter().map(search).filter(|s| !s.is_empty()).collect(),
        None => vec![search(&entity)],
    };
    if tracks.is_empty() {
        return Err("Ese enlace de Spotify no tiene canciones".into());
    }
    let videos = youtube_ids(&client, &tracks).await;
    if videos.iter().all(Option::is_none) {
        return Err("No encontré esas canciones en YouTube (¿hay internet?)".into());
    }
    let title = entity["name"].as_str().or(entity["title"].as_str()).map(str::to_string);
    Ok(LinkInfo { title, tracks, videos })
}

/// Busca en YouTube cada canción, de a 8 a la vez, y se queda con el primer video.
async fn youtube_ids(client: &reqwest::Client, searches: &[String]) -> Vec<Option<String>> {
    let mut found = Vec::with_capacity(searches.len());
    for batch in searches.chunks(8) {
        let tasks: Vec<_> = batch
            .iter()
            .map(|search| {
                let client = client.clone();
                let search = format!("{search} audio");
                tauri::async_runtime::spawn(async move { youtube_id(&client, &search).await })
            })
            .collect();
        for task in tasks {
            found.push(task.await.ok().flatten());
        }
    }
    found
}

async fn youtube_id(client: &reqwest::Client, search: &str) -> Option<String> {
    let url = Url::parse_with_params("https://www.youtube.com/results", &[("search_query", search)]).ok()?;
    first_video(&get_text(client, url).await.ok()?)
}

/// El primer video de una página de resultados de YouTube.
fn first_video(page: &str) -> Option<String> {
    const KEY: &str = r#""videoId":""#;
    let data = &page[page.find("ytInitialData")?..];
    let start = data.find(KEY)? + KEY.len();
    let id = data.get(start..start + 11)?;
    id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_').then(|| id.to_string())
}

/// Los datos que la página para insertar de Spotify trae escritos adentro.
fn spotify_entity(page: &str) -> Option<Value> {
    const START: &str = r#"<script id="__NEXT_DATA__" type="application/json">"#;
    let rest = &page[page.find(START)? + START.len()..];
    let data: Value = serde_json::from_str(&rest[..rest.find("</script>")?]).ok()?;
    let entity = data.pointer("/props/pageProps/state/data/entity")?;
    entity.is_object().then(|| entity.clone())
}

/// Dónde está Brave, si está instalado.
fn brave() -> Option<PathBuf> {
    const EXE: &str = r"BraveSoftware\Brave-Browser\Application\brave.exe";
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|base| Path::new(&base).join(EXE))
        .find(|path| path.is_file())
}

/// Abre la música en una ventana nueva del Brave del usuario o, sin Brave, en
/// su navegador. Solo páginas de YouTube.
#[tauri::command(async)]
pub fn open_in_browser(url: String) -> Result<&'static str, String> {
    let url = Url::parse(&url).map_err(|_| "Ese enlace no se entiende".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("www.youtube.com") {
        return Err("Solo se abren páginas de YouTube".into());
    }
    let (opened, browser) = match brave() {
        Some(exe) => (Command::new(exe).arg("--new-window").arg(url.as_str()).spawn(), "Brave"),
        None => (Command::new("explorer.exe").arg(url.as_str()).spawn(), "tu navegador"),
    };
    opened.map(|_| browser).map_err(|e| format!("No se pudo abrir {browser}: {e}"))
}

/// Lo que suena en el navegador, según los controles multimedia de Windows
/// (los que salen junto al volumen). Brave se anota ahí como "Brave".
fn browser_session() -> Option<GlobalSystemMediaTransportControlsSession> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?.join().ok()?;
    let sessions = manager.GetSessions().ok()?;
    let browsers = ["brave", "chrome", "msedge", "firefox", "opera"];
    (0..sessions.Size().ok()?)
        .filter_map(|i| sessions.GetAt(i).ok())
        .find(|s| {
            let app = s.SourceAppUserModelId().map(|id| id.to_string().to_lowercase()).unwrap_or_default();
            browsers.iter().any(|b| app.contains(b))
        })
}

#[derive(Serialize)]
pub struct NowPlaying {
    title: String,
    artist: String,
    playing: bool,
}

/// La canción que suena en el navegador, si hay una.
#[tauri::command(async)]
pub fn media_now() -> Option<NowPlaying> {
    let session = browser_session()?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let playing = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?
        == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
    Some(NowPlaying {
        title: props.Title().map(|t| t.to_string()).unwrap_or_default(),
        artist: props.Artist().map(|t| t.to_string()).unwrap_or_default(),
        playing,
    })
}

/// "playpause", "pause", "next" o "previous" a lo que suena en el navegador.
#[tauri::command(async)]
pub fn media_control(action: String) -> Result<(), String> {
    let session = browser_session().ok_or("No hay música sonando en el navegador")?;
    let done = match action.as_str() {
        "playpause" => session.TryTogglePlayPauseAsync(),
        "pause" => session.TryPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "previous" => session.TrySkipPreviousAsync(),
        _ => return Err(format!("No sé hacer «{action}»")),
    };
    match done.and_then(|op| op.join()) {
        Ok(true) => Ok(()),
        _ if action == "next" || action == "previous" => {
            Err("Es una sola canción: no hay otra a la que pasar".into())
        }
        _ => Err("El navegador no respondió".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lee_las_canciones_de_spotify() {
        let page = r#"<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"name":"Hora loca","trackList":[{"title":"Tusa","subtitle":"KAROL G, Nicki Minaj"}]}}}}}}</script></html>"#;
        let entity = spotify_entity(page).unwrap();
        assert_eq!(entity["name"], "Hora loca");
        assert_eq!(entity["trackList"][0]["title"], "Tusa");
    }

    #[test]
    fn toma_el_primer_video_de_la_busqueda() {
        let page = r#"<script>"videoId":"ANUNCIO0000"</script><script>var ytInitialData = {"contents":[{"videoRenderer":{"videoId":"Qlsu7RhOnsQ"}},{"videoRenderer":{"videoId":"kJQP7kiw5Fk"}}]}</script>"#;
        assert_eq!(first_video(page).as_deref(), Some("Qlsu7RhOnsQ"));
        assert_eq!(first_video("sin resultados"), None);
    }
}
