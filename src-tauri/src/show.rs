//! El show (fixtures, escenas, grupos, chases, effects) en disco, para que no
//! dependa del almacenamiento interno de WebView2. Viaja como JSON opaco: su
//! forma la define `src/lib/fixtureStore.tsx`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

fn show_path(app: &AppHandle) -> Result<PathBuf, String> {
    data_path(app, "show.json")
}

/// Escribe a un temporal y lo renombra: si se corta la luz a mitad del
/// guardado, queda el show anterior completo en vez de uno a medias.
pub(crate) fn write_atomic(path: &Path, json: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    fs::rename(tmp, path)
}

/// `None` si no hay show guardado. Uno ilegible se aparta como
/// `show.corrupto.json` para poder rescatarlo, en vez de pisarlo al guardar.
fn read_show(path: &Path) -> std::io::Result<Option<String>> {
    let json = match fs::read_to_string(path) {
        Ok(json) => json,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => String::new(),
        Err(e) => return Err(e),
    };
    if serde_json::from_str::<serde_json::Value>(&json).is_ok() {
        return Ok(Some(json));
    }
    fs::rename(path, path.with_file_name("show.corrupto.json"))?;
    Ok(None)
}

#[tauri::command(async)]
pub fn load_show(app: AppHandle) -> Result<Option<String>, String> {
    read_show(&show_path(&app)?).map_err(|e| e.to_string())
}

/// Cuántos días de respaldo se guardan.
const KEEP_BACKUPS: usize = 14;

/// "2026-11-27": el día lo pone la ventana, que sabe la hora de Perú.
fn is_day(day: &str) -> bool {
    let b = day.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    data_path(app, "respaldos")
}

/// Antes del primer guardado de cada día, el show como estaba queda en
/// `respaldos/show-<día>.json`; los de hace más de dos semanas se borran.
fn backup_before_save(show: &Path, dir: &Path, day: &str) -> std::io::Result<()> {
    let target = dir.join(format!("show-{day}.json"));
    if !is_day(day) || target.exists() || !show.exists() {
        return Ok(());
    }
    fs::create_dir_all(dir)?;
    fs::copy(show, &target)?;
    let mut days = backup_days(dir);
    for old in days.split_off(KEEP_BACKUPS.min(days.len())) {
        let _ = fs::remove_file(dir.join(format!("show-{old}.json")));
    }
    Ok(())
}

/// Los días con respaldo, del más nuevo al más viejo.
fn backup_days(dir: &Path) -> Vec<String> {
    let mut days: Vec<String> = fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok()?.file_name().into_string().ok())
                .filter_map(|name| Some(name.strip_prefix("show-")?.strip_suffix(".json")?.to_owned()))
                .filter(|day| is_day(day))
                .collect()
        })
        .unwrap_or_default();
    days.sort_by(|a, b| b.cmp(a));
    days
}

#[tauri::command(async)]
pub fn save_show(app: AppHandle, json: String, day: Option<String>) -> Result<(), String> {
    let path = show_path(&app)?;
    if let Some(day) = day {
        // Un respaldo que falla no puede impedir guardar.
        if let Err(e) = backups_dir(&app).and_then(|dir| backup_before_save(&path, &dir, &day).map_err(|e| e.to_string())) {
            eprintln!("No se pudo guardar el respaldo del día: {e}");
        }
    }
    write_atomic(&path, &json).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn list_backups(app: AppHandle) -> Result<Vec<String>, String> {
    Ok(backup_days(&backups_dir(&app)?))
}

#[tauri::command(async)]
pub fn read_backup(app: AppHandle, day: String) -> Result<String, String> {
    if !is_day(&day) {
        return Err("Ese día no vale".into());
    }
    fs::read_to_string(backups_dir(&app)?.join(format!("show-{day}.json"))).map_err(|e| e.to_string())
}

/// Preferencias de esta PC (src/lib/settings.ts).
#[tauri::command(async)]
pub fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(data_path(&app, "settings.json")?).ok())
}

#[tauri::command(async)]
pub fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    write_atomic(&data_path(&app, "settings.json")?, &json).map_err(|e| e.to_string())
}

/// Las canciones de las líneas de tiempo, junto al show. El nombre viene de
/// la ventana: solo un nombre de archivo, nunca una ruta.
fn song_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    if !is_song_name(file) {
        return Err("Ese nombre de canción no vale".into());
    }
    let dir = data_path(app, "canciones")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

fn is_song_name(file: &str) -> bool {
    !file.is_empty() && file.len() <= 64 && file.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') && !file.starts_with('.')
}

/// Copia la canción elegida y devuelve con qué nombre quedó. La extensión
/// llega en la cabecera `x-ext`; los bytes, tal cual.
#[tauri::command]
pub async fn save_song(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No llegó la canción".into());
    };
    let ext: String = request
        .headers()
        .get("x-ext")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("mp3")
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(5)
        .collect();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    let file = format!("cancion-{stamp}.{}", if ext.is_empty() { "mp3" } else { &ext });
    fs::write(song_path(&app, &file)?, bytes).map_err(|e| e.to_string())?;
    Ok(file)
}

#[tauri::command(async)]
pub fn read_song(app: AppHandle, file: String) -> Result<tauri::ipc::Response, String> {
    match fs::read(song_path(&app, &file)?) {
        Ok(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("No encuentro la canción: vuelve a cargarla".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Guarda una copia en Documentos\LUMEN PRO y devuelve la ruta.
#[tauri::command(async)]
pub fn export_show(app: AppHandle, file_name: String, json: String) -> Result<String, String> {
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("LUMEN PRO");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(file_name);
    write_atomic(&path, &json).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_show(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lumenpro-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir.join("show.json")
    }

    #[test]
    fn the_first_save_of_each_day_keeps_how_the_show_was_and_only_two_weeks_stay() {
        let show = temp_show("backup");
        let dir = show.with_file_name("respaldos");
        write_atomic(&show, r#"{"v":"ayer"}"#).unwrap();
        backup_before_save(&show, &dir, "2026-11-27").unwrap();
        write_atomic(&show, r#"{"v":"hoy 1"}"#).unwrap();
        // El segundo guardado del día no pisa el respaldo.
        backup_before_save(&show, &dir, "2026-11-27").unwrap();
        assert_eq!(fs::read_to_string(dir.join("show-2026-11-27.json")).unwrap(), r#"{"v":"ayer"}"#);

        for day in 1..=20 {
            backup_before_save(&show, &dir, &format!("2026-12-{day:02}")).unwrap();
        }
        let days = backup_days(&dir);
        assert_eq!(days.len(), KEEP_BACKUPS);
        assert_eq!(days[0], "2026-12-20");
        assert!(!days.contains(&"2026-11-27".to_owned()));
        // Un día mal escrito no hace nada.
        backup_before_save(&show, &dir, "../x").unwrap();
        assert_eq!(backup_days(&dir).len(), KEEP_BACKUPS);
    }

    #[test]
    fn song_names_cannot_leave_the_songs_folder() {
        assert!(is_song_name("cancion-1764184000000.mp3"));
        for bad in ["", "..", "../show.json", "a/b.mp3", "a\\b.mp3", ".oculto", "C:x.mp3"] {
            assert!(!is_song_name(bad), "{bad}");
        }
    }

    #[test]
    fn missing_show_is_none() {
        assert_eq!(read_show(&temp_show("missing")).unwrap(), None);
    }

    #[test]
    fn saving_twice_keeps_the_last_version_and_no_temp_file() {
        let path = temp_show("save");
        write_atomic(&path, r#"{"v":1}"#).unwrap();
        write_atomic(&path, r#"{"v":2}"#).unwrap();
        assert_eq!(read_show(&path).unwrap().as_deref(), Some(r#"{"v":2}"#));
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn corrupt_show_is_set_aside_not_lost() {
        let path = temp_show("corrupt");
        fs::write(&path, r#"{"scenes":[{"na"#).unwrap();
        assert_eq!(read_show(&path).unwrap(), None);
        let rescued = fs::read_to_string(path.with_file_name("show.corrupto.json")).unwrap();
        assert!(rescued.starts_with(r#"{"scenes""#));
    }
}
