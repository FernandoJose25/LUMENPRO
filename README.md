# LUMEN PRO — UI

Capa de frontend (Design System + Workspace shell) para la consola DMX
LUMEN PRO. Ver `AUDIT.md` para el detalle completo de qué se implementó,
qué se difirió y por qué.

## Stack

React 18 + TypeScript (estricto) + Vite + Tailwind CSS +
`react-resizable-panels`. Pensado para envolverse en Tauri 2 más
adelante (sección 31 del brief original) sin cambios estructurales.

## Estructura

```
src/
  components/ui/         Design System: Button, Panel, Fader, Tabs, StatusIndicator
  components/layout/     Sidebar, Topbar, BlackoutButton
  components/fixtures/   FixtureManager, FixtureEditor, FixtureControl
  components/scenes/     ScenesPanel — guardar/recuperar/renombrar/borrar escenas (Fase 4)
  components/views/      DashboardView, FixturesView, PlaceholderView
  types/fixture.ts       Modelo de datos (FixtureDefinition, FixtureInstance, FixtureChannel)
  types/scene.ts          Modelo de datos de Scenes (foto de liveValues por fixture/canal)
  data/fixtureLibrary.ts Semilla: tu rig real (2x Orus 280W, 4x LPC007) — ver AUDIT.md §7.2
  lib/fixtureStore.tsx   Store con persistencia en localStorage (placeholder hasta Tauri+SQLite).
                          Incluye liveValues (valores de canal en vivo) y CRUD de Scenes.
  lib/utils.ts           helper cn()
  App.tsx                 Enruta Dashboard / Fixtures / placeholders por fase
dmx-engine/               Motor DMX en Rust (crate independiente, ver AUDIT.md §8)
src-tauri/                Andamiaje de la app de escritorio (ver PASOS-PENDIENTES.md)
```

## Comandos

```bash
npm install
npm run dev        # servidor de desarrollo (web)
npm run build       # build de producción (web)
npm run typecheck
```

### Motor DMX (Rust)

```bash
cd dmx-engine
cargo test              # 8/8 tests
cargo run --bin smoke_test
```

### App de escritorio (Tauri)

`src-tauri/` tiene el andamiaje base, pero **no verificado** contra un
build real (ver PASOS-PENDIENTES.md). Requiere Rust actualizado vía
`rustup` (no la versión de `apt`) y, en Linux, `libwebkit2gtk-4.1-dev`:

```bash
cargo install tauri-cli --version "^2"
npm run tauri dev     # una vez que compile de verdad
```
