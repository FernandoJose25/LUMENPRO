# Iconos pendientes

`tauri.conf.json` referencia `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns` e `icon.ico`, pero **ninguno existe todavía en esta carpeta**.

`cargo tauri dev` no debería necesitarlos, pero `cargo tauri build`
(el paso que genera el instalador / `.exe`) sí va a fallar hasta que estén.

Cuando haya un logo real de LUMEN PRO:

```bash
cargo install tauri-cli --version "^2"
cargo tauri icon ruta/al/logo.png
```

Eso genera automáticamente todos los tamaños/formatos que pide
`tauri.conf.json` a partir de una sola imagen fuente (idealmente ≥1024x1024).
