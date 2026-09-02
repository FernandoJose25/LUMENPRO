# LUMENPRO — Pasos pendientes

> Repo: https://github.com/FernandoJose25/LUMENPRO — rama `main` ya sincronizada.

## ✅ Completado

- Fase 1 — Design System (tokens, Button, Panel, Fader, Tabs, StatusIndicator)
- Fase 2 — Workspace shell (Sidebar, Topbar, Blackout, paneles redimensionables)
- Fase 3 (parcial) — Fixture Manager, Fixture Editor, Fixture Control dinámico
- Repo Git inicializado y subido a GitHub
- **Motor DMX en Rust** (`dmx-engine/`, crate independiente) — universo de
  512 canales, hilo de salida a FPS fijo, driver Enttec DMX USB PRO +
  Mock para desarrollar sin hardware. Compila, 8/8 tests pasan, smoke
  test corrido contra Mock. **No probado contra hardware real** — ver
  AUDIT.md §8.

## 🔲 Pendiente — Fase 3 (cerrar Fixtures)

- [ ] **Confirmar direcciones DMX reales** de las 6 instancias sembradas
      (2x Orus 280W, 4x Big Dipper LPC007) contra la consola física MAX 512
      — hoy están secuenciales sin verificar
- [ ] Verificar el orden de canales del Big Dipper LPC007 modo 7CH contra
      la hoja oficial del fabricante (hoy es una plantilla estándar sin confirmar)
- [ ] Verificar el layout de 16 canales del "Orus" 280W (marca no identificada
      en manuales públicos — plantilla genérica sin confirmar)
- [ ] Control XY dedicado para Pan/Tilt (hoy usa `Fader` genérico)
- [ ] Color wheel visual, selector de gobo con miniaturas, editor de curvas gráfico
- [ ] Persistencia real (hoy `localStorage`, migrar a SQLite cuando exista Tauri)

## 🔲 Pendiente — Fase 4: Scenes / Chases / Effects / Groups

- [ ] Lógica real detrás de los botones de escenas (hoy son placeholders)
- [ ] Editor de chases
- [ ] Motor de efectos
- [ ] Agrupación de fixtures

## 🔲 Pendiente — Motor y hardware

- [x] Motor DMX en Rust — hecho como crate independiente `dmx-engine/`
      (ver AUDIT.md §8). Falta integrarlo a `src-tauri` cuando exista.
- [x] Driver USB-DMX — implementado el protocolo Enttec DMX USB PRO
      (label 6) sobre `serialport`. **Sin probar contra hardware real.**
      Art-Net/sACN (para no depender de un widget USB) sigue sin hacer.
- [ ] Empaquetado Tauri — **aquí es donde recién se genera el `.exe`**.
      Siguiente paso lógico: `cargo install tauri-cli`, `cargo tauri init`
      dentro del repo, y mover `dmx-engine` como dependencia local.
- [ ] Doble monitor (depende de Tauri, gestión de ventanas nativas)

## 🔲 Pendiente — Visualizer y extras

- [ ] Visualizer 2D/3D (hoy es un placeholder vacío en el Dashboard)
- [ ] Live Mode separado
- [ ] Command Palette / atajos globales
- [ ] Audio Reactive

## Orden recomendado

1. Confirmar direcciones DMX y canales reales (bloquea todo lo demás con hardware)
2. ~~Motor DMX en Rust + driver USB-DMX~~ — hecho como crate `dmx-engine/`,
   sin probar contra hardware (paso 1 sigue pendiente y esto lo bloquea)
3. Envolver en Tauri (ya ahí puedes probar el `.exe` real, aunque sea sin visualizer)
4. Scenes/Chases/Effects
5. Visualizer 2D/3D
6. Resto de pulido (Live Mode, Command Palette, Audio Reactive, doble monitor)
