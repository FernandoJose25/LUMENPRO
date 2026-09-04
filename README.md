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
  components/scenes/     ScenesPanel + ScenesView — guardar/recuperar/renombrar/borrar escenas (Fase 4)
  components/groups/     GroupsView — crear/renombrar/borrar grupos, asignar fixtures, control por lote (Fase 4)
  components/chases/     ChasesView — secuencias de escenas con fade/hold, reproducir/detener (Fase 4)
  components/effects/    EffectsView — generadores paramétricos (seno/cuadrada/etc.) sobre un grupo (Fase 4)
  components/visualizer/ StageVisualizer — puntos de luz en vivo, color/brillo real desde liveValues
  components/views/      DashboardView, FixturesView, PlaceholderView
  types/fixture.ts       Modelo de datos (FixtureDefinition, FixtureInstance, FixtureChannel)
  types/scene.ts          Modelo de datos de Scenes (foto de liveValues por fixture/canal)
  types/group.ts          Modelo de datos de Groups (Group { id, name, color })
  types/chase.ts           Modelo de datos de Chases (Chase { steps: ChaseStep[], loop }, cada step referencia una Scene)
  types/effect.ts          Modelo de datos de Effects (Effect { groupId, channelType, waveform, ... })
  data/fixtureLibrary.ts Semilla: tu rig real (2x Orus 280W, 4x LPC007) — ver AUDIT.md §7.2
  lib/fixtureStore.tsx   Store con persistencia en localStorage (placeholder hasta Tauri+SQLite).
                          Incluye liveValues, CRUD de Scenes, Groups, Chases y Effects.
  lib/chasePlayer.ts     Motor de reproducción de Chases (interpolación en el navegador, ver AUDIT.md §8)
  lib/effectEngine.ts    Motor de reproducción de Effects — un único intervalo global, montado en App.tsx
  lib/utils.ts           helper cn()
  App.tsx                 Enruta Dashboard / Fixtures / Groups / Scenes / Chases / Effects / placeholders por fase
  test/                   Tests de integración (Vitest + Testing Library + jsdom) — `npm test`
dmx-engine/               Motor DMX en Rust (crate independiente, ver AUDIT.md §8)
src-tauri/                Andamiaje de la app de escritorio (ver PASOS-PENDIENTES.md)
```

## Comandos

```bash
npm install
npm run dev        # servidor de desarrollo (web)
npm run build       # build de producción (web)
npm run typecheck
npm test            # tests de integración (Vitest + Testing Library + jsdom)
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
