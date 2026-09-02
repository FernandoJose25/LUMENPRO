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
- **Andamiaje de Tauri** (`src-tauri/`) — `Cargo.toml`, `tauri.conf.json`,
  `main.rs` con comandos (`connect_mock`, `connect_enttec`, `disconnect`,
  `set_channel`, `get_channel`, `set_block`, `blackout`, `list_serial_ports`,
  `engine_status`) que envuelven `lumenpro_dmx` como dependencia local. `npm
  install` con `@tauri-apps/cli`/`@tauri-apps/api` corrido y verificado; el
  build del frontend (`npm run build`, `npm run typecheck`) sigue pasando.
  **`cargo check`/`cargo tauri dev` de `src-tauri` NO se pudo verificar en
  este entorno**: el sandbox trae Rust 1.75 (vía `apt`) y las dependencias
  actuales de Tauri 2 requieren un toolchain más nuevo (`edition2024`);
  tampoco había `libwebkit2gtk-4.1-dev` instalable (mirror de Ubuntu
  devolvía 404 para esos paquetes). Falta además generar los iconos reales
  (ver `src-tauri/icons/README.md`) antes de poder correr `cargo tauri
  build`. **Antes de dar este paso por cerrado, alguien con Rust actualizado
  (`rustup`, no el `apt` de Ubuntu) y, si es posible, en Windows —el target
  real del `.exe`— debe correr `cargo tauri dev` y arreglar lo que falle.**

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

- [x] **Scenes** — lógica real, ya no son placeholders. `fixtureStore` ahora
      tiene `liveValues` (instanceId→channelId→valor, antes vivía como
      `useState` local en `FixtureControl` y se perdía al cambiar de fixture)
      y `scenes: Scene[]` (`types/scene.ts`). Guardar captura una foto de
      `liveValues`; recuperar hace *merge* (solo pisa los canales que esa
      escena capturó, no un blackout del resto del rig — igual que en una
      consola real). Nuevo componente `components/scenes/ScenesPanel.tsx`
      reemplaza el bloque de botones hardcodeados (`SCENES = [...]`) del
      Dashboard: guardar (prompt de nombre), recuperar (clic), re-grabar
      (⟳, sobre una escena existente), renombrar (doble clic) y borrar (×,
      con confirmación) — todo persistido en `localStorage` junto con
      fixtures. `npm run typecheck` y `npm run build` verificados OK.
      **Sin tests automatizados** (no hay `vitest`/`jest` configurado en el
      repo todavía) — la verificación fue lectura de código + typecheck +
      build, no una corrida manual en el navegador.
- [ ] Editor de chases (secuencias de escenas con tiempos/crossfade)
- [ ] Motor de efectos (generadores paramétricos: sine, chase de color, etc.)
- [ ] Agrupación de fixtures como entidad de primera clase — hoy
      `FixtureInstance.group?: string` existe en el tipo (`types/fixture.ts`)
      pero ninguna pantalla lo usa: no hay forma de crear/editar/asignar
      grupos, ni de recuperar una escena "solo para el grupo X"

## 🔲 Pendiente — Motor y hardware

- [x] Motor DMX en Rust — hecho como crate independiente `dmx-engine/`
      (ver AUDIT.md §8). Falta integrarlo a `src-tauri` cuando exista.
- [x] Driver USB-DMX — implementado el protocolo Enttec DMX USB PRO
      (label 6) sobre `serialport`. **Sin probar contra hardware real.**
      Art-Net/sACN (para no depender de un widget USB) sigue sin hacer.
- [ ] Empaquetado Tauri — **aquí es donde recién se genera el `.exe`**.
      Andamiaje base ya en `src-tauri/` (`Cargo.toml`, `tauri.conf.json`,
      `main.rs` con comandos IPC sobre `dmx-engine`), **pero sin `cargo tauri
      dev`/`build` corrido con éxito todavía** — requiere Rust actualizado vía
      `rustup` (no el 1.75 de `apt`), `libwebkit2gtk-4.1-dev` instalado, e
      iconos reales generados con `cargo tauri icon`. Todo eso solo se puede
      hacer/verificar fuera de este sandbox.
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
3. Envolver en Tauri — andamiaje escrito (`src-tauri/`), **falta correr
   `cargo tauri dev`/`build` con Rust actualizado y confirmar que compila**
   antes de poder probar el `.exe` real
4. Scenes (hecho) → Chases/Effects/Groups (pendientes)
5. Visualizer 2D/3D
6. Resto de pulido (Live Mode, Command Palette, Audio Reactive, doble monitor)
