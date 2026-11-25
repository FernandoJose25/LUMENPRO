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

#[tauri::command(async)]
pub fn save_show(app: AppHandle, json: String) -> Result<(), String> {
    write_atomic(&show_path(&app)?, &json).map_err(|e| e.to_string())
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
