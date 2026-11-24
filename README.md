# LUMEN PRO — Consola de iluminación DMX

[![CI](https://github.com/FernandoJose25/LUMENPRO/actions/workflows/ci.yml/badge.svg)](https://github.com/FernandoJose25/LUMENPRO/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-motor%20DMX-000000?logo=rust)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)

Software de escritorio para controlar luces de escenario por **DMX512**: cabezas móviles, PARs y otros equipos. Es una alternativa propia a consolas como MA o Chamsys, pensada para el equipo real de mi empresa de eventos (2× cabezas móviles Beam 280 y 4× PAR LED).

> **English summary:** Desktop DMX512 lighting console. React + TypeScript UI (design system, resizable workspace, fixture control, scenes, groups, chases with crossfades, parametric effects, live 2D visualizer) plus a Rust DMX engine (512-channel universe, fixed-FPS output thread with automatic reconnection, Open DMX (FTDI) and Enttec DMX USB PRO drivers plus a mock driver) connected to the UI through Tauri 2 commands. Integration tests with Vitest + Testing Library and unit tests in Rust.

![Simulador del escenario](docs/screenshots/escenario.png)

![Dashboard de LUMEN PRO](docs/screenshots/dashboard.png)

## Mi rol

Lo diseñé y desarrollé solo, a partir de un brief de producto propio de 37 secciones: design system, UI, modelo de datos, motor DMX en Rust e integración con Tauri. La auditoría de lo construido frente al brief está en [AUDIT.md](AUDIT.md).

## Qué hace

- **Design system propio:** Button, Panel, Fader, Tabs e indicadores de estado, con tokens de color y tipografía.
- **Workspace profesional:** sidebar, topbar con estado del DMX, paneles redimensionables, **Blackout** global y paleta de comandos (`Ctrl/Cmd + K`).
- **Fixtures:** biblioteca, editor de canales y control dinámico. Los faders, colores y presets se generan según el perfil de cada equipo (pan/tilt, dimmer, color wheel, gobo, prisma, etc.).
- **Scenes:** guardan una foto de los valores en vivo y luego se recuperan, re-graban o renombran.
- **Groups:** agrupan fixtures para controlarlos por lote.
- **Chases:** secuencias de escenas con fade y hold, en bucle o una sola vez.
- **Momentos:** el evento en orden (Entrada, Vals, Fotos, Hora loca…). Cada uno junta escena, chase y effects en un botón, con "Siguiente", transición y avance automático opcional. Incluye una plantilla de quinceañera.
- **Control por celular:** página en la red local (QR + PIN) con Siguiente, momentos, intensidad, estrobo y Blackout.
- **Effects:** generadores paramétricos (seno, cuadrada…) aplicados sobre un grupo, con un único motor de intervalos global.
- **Simulador del escenario:** haces en perspectiva con pan/tilt, color, zoom y estrobo reales, posiciones editables y cámara libre. Sin dependencias 3D: proyección propia sobre canvas.
- **Equipos sin manual:** identificador que barre canal por canal y guarda su función, valor inicial y presets.
- **Motor DMX en Rust** (`dmx-engine/`):
  - universo de 512 canales thread-safe;
  - hilo de salida a FPS fijo;
  - drivers para **cable FTDI (Open DMX)** y **Enttec DMX USB PRO** por puerto serie;
  - reconexión automática si se suelta el cable;
  - driver Mock para desarrollar sin hardware.
- **App de escritorio con Tauri 2** (`src-tauri/`): expone el motor como comandos (`connect_open_dmx`, `connect_enttec`, `set_block`, `engine_status`, `list_serial_ports`…) y guarda el show en disco, con exportar e importar.

## Stack

| Capa | Tecnologías |
|---|---|
| UI | React 18, TypeScript estricto, Vite, Tailwind CSS, react-resizable-panels |
| Estado | Store propio con Context; el show se guarda en `show.json` (app) o `localStorage` (navegador) |
| Motor | Rust: crate `lumenpro_dmx`, hilos, `serialport` |
| Escritorio | Tauri 2 |
| Calidad | Vitest + Testing Library + jsdom (132 tests), `cargo test` (26 tests), GitHub Actions |

## Estructura

```
src/components/   ui/ (design system) · layout/ · fixtures/ · scenes/ · groups/ · chases/ · effects/ · moments/ · stage/ · dmx/ · remote/ · live/ · command-palette/
src/lib/          fixtureStore (estado + persistencia), chasePlayer, effectEngine, momentsEngine, dmxFrame, dmxOutput, remoteControl, stage
src/types/        Modelo de datos: fixture, scene, group, chase, effect, moment
src/test/         Tests de integración
dmx-engine/       Motor DMX en Rust (crate independiente)
src-tauri/        App de escritorio Tauri 2: motor DMX, show en disco y servidor del celular
```

## Correr el proyecto

```bash
npm install
npm run dev          # UI en el navegador
npm test             # tests de integración
npm run build        # typecheck + build de producción

cd dmx-engine && cargo test           # motor DMX
cd src-tauri && cargo check           # app de escritorio
npm run tauri dev                     # app de escritorio con la UI
npm run tauri build                   # instalador .exe (src-tauri/target/release/bundle/nsis)
```

## Estado y siguiente paso

La interfaz ya envía los 512 canales al motor DMX y la app se empaqueta como `.exe`. El show se maneja desde la laptop o el celular. Falta probarlo con el adaptador y las luces reales. El detalle está en [PASOS-PENDIENTES.md](PASOS-PENDIENTES.md).
