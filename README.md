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
  components/views/      DashboardView, FixturesView, PlaceholderView
  types/fixture.ts       Modelo de datos (FixtureDefinition, FixtureInstance, FixtureChannel)
  data/fixtureLibrary.ts Semilla: tu rig real (2x Orus 280W, 4x LPC007) — ver AUDIT.md §7.2
  lib/fixtureStore.tsx   Store con persistencia en localStorage (placeholder hasta Tauri+SQLite)
  lib/utils.ts           helper cn()
  App.tsx                 Enruta Dashboard / Fixtures / placeholders por fase
```

## Comandos

```bash
npm install
npm run dev        # servidor de desarrollo
npm run build       # build de producción
npm run typecheck
```
