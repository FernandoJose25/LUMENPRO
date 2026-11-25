//! Carpeta de WebView2. Cuando la ventana se cae, su navegador puede tardar
//! medio minuto en soltar la carpeta y una ventana nueva no arrancaría: en ese
//! caso se usa una de reserva.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const SPARES: usize = 4;

/// El navegador crea `lockfile` al abrir y lo tiene tomado mientras vive.
fn is_busy(dir: &Path) -> bool {
    match fs::remove_file(dir.join("EBWebView").join("lockfile")) {
        Ok(()) => false, // quedó de una caída: nadie lo tiene
        Err(e) => e.kind() != ErrorKind::NotFound,
    }
}

pub fn pick(base: &Path) -> PathBuf {
    let spare = |i: usize| base.join(format!("ventana-{i}"));
    if !is_busy(base) {
        // Las de reserva no guardan nada que haga falta.
        for dir in (1..=SPARES).map(spare).filter(|dir| dir.exists() && !is_busy(dir)) {
            let _ = fs::remove_dir_all(dir);
        }
        return base.into();
    }
    (1..=SPARES).map(spare).find(|dir| !is_busy(dir)).unwrap_or_else(|| base.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lumenpro-webview-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("EBWebView")).unwrap();
        dir
    }

    #[test]
    fn a_free_folder_is_used_even_with_a_stale_lock_and_spares_are_cleaned() {
        let base = temp("free");
        fs::write(base.join("EBWebView/lockfile"), "").unwrap();
        fs::create_dir_all(base.join("ventana-1/EBWebView")).unwrap();
        assert_eq!(pick(&base), base);
        assert!(!base.join("ventana-1").exists());
    }

    /// Como lo abre Chromium: sin compartir el borrado.
    #[cfg(windows)]
    fn hold(dir: &Path) -> fs::File {
        use std::os::windows::fs::OpenOptionsExt;
        fs::create_dir_all(dir.join("EBWebView")).unwrap();
        let path = dir.join("EBWebView").join("lockfile");
        fs::OpenOptions::new().write(true).create(true).truncate(true).share_mode(1).open(path).unwrap()
    }

    #[cfg(windows)]
    #[test]
    fn a_busy_folder_gives_way_to_the_next_free_one() {
        let base = temp("busy");
        let _main = hold(&base);
        assert_eq!(pick(&base), base.join("ventana-1"));
        let _first = hold(&base.join("ventana-1"));
        assert_eq!(pick(&base), base.join("ventana-2"));
    }
}
