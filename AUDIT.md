# Auditoría — LUMEN PRO UI

Este documento audita, paso a paso, lo que se construyó a partir de
`ui_ux_desktop_dmx_pro.md`, qué se dejó fuera y por qué.

> **Nota de nombre de carpeta**: la raíz del repo es `LUMENPRO` (indicado
> por Fernando). El código interno sigue usando `lumen-pro-ui` como
> nombre de paquete npm — no afecta el funcionamiento, solo es el nombre
> en `package.json`.

## 0. Alcance real vs. alcance del documento

El documento describe una consola DMX profesional completa: motor DMX en
Rust, visualizer 2D/3D con WebGL, empaquetado Tauri, motor de efectos,
editor de chases con audio-sync, MIDI/OSC, doble monitor, etc. Eso es un
producto de varios meses con un equipo (o mucho tiempo solo). No se puede
producir de verdad en una sesión, y fingir que sí habría sido peor que ser
directo al respecto.

Lo que se construyó aquí es real, corre, compila y tipa — no es un mockup:
**Fase 1 (Design System) completa + arranque de Fase 2 (Workspace)**,
siguiendo el propio plan de fases de la sección 33 del documento.

## 1. Pasos ejecutados (orden real)

1. Leído el documento completo (1180 líneas, 37 secciones) — incluida la
   parte truncada en la primera vista (líneas 422–757).
2. Leída la skill `frontend-design` — el brief ya fija paleta, tipografía
   y principios exactos (sección 18), así que se siguieron literalmente en
   vez de inventar una dirección visual nueva.
3. Revisada la memoria del proyecto (`lumen-pro`) para contexto del rig
   físico (2× Orus 280W, 4× Big Dipper LPC007) — no había un nombre de
   repo existente, así que se asumió `lumen-pro-ui` como nombre de
   proyecto para esta capa de frontend. **Si ya tienes un repo con otro
   nombre, dímelo y ajusto los paths.**
4. Scaffold del proyecto: Vite + React 18 + TypeScript estricto + Tailwind
   (stack recomendado en la sección 31, sin Tauri todavía — ver §3 más
   abajo sobre por qué).
5. Tokens de color/tipografía trasladados literalmente de la sección 18.
6. Construidos los componentes base del Design System (sección 32) con
   sus estados (sección: default/hover/active/selected/disabled/error/
   loading): `Button`, `Panel`, `Fader`, `StatusIndicator`, `Tabs`.
7. Construido el shell de Workspace (secciones 2–4): `Sidebar` colapsable,
   `Topbar` con estado crítico, `BlackoutButton` siempre visible fuera de
   cualquier menú.
8. Ensamblado un Dashboard de demostración (sección 5) con paneles
   redimensionables reales (`react-resizable-panels`), usando los
   componentes anteriores con datos de ejemplo.
9. **Verificación real, no narrada**: `npm install` → `tsc -b --noEmit`
   (0 errores tras dos rondas de fixes de config) → `npm run build`
   (build de producción exitoso, ver salida de Vite abajo). No se
   entregó nada sin que compilara.
10. Escrita esta auditoría.

## 2. Decisiones que tomé y que el documento no fijaba explícitamente

| Decisión | Dónde | Por qué |
|---|---|---|
| Accent violeta específico `#A66CFF` | tokens | El brief dice "Purple / configurable" sin hex; elegí un violeta con matiz UV, coherente con el preset "UV" que el propio documento menciona en la sección 29 |
| Tipografía: Inter Variable (UI) + monoespaciada del sistema (valores DMX) | tokens, `Fader` | El brief lista Inter/Geist/IBM Plex Sans como opciones. Inter Variable se puede *bundlear* offline (`@fontsource-variable`), cumpliendo el requisito "debe funcionar perfectamente sin conexión a Internet" (sección 1) sin depender de Google Fonts en runtime |
| Blackout con confirmación de doble clic (armado 1.5s) | `BlackoutButton.tsx` | Sección 21: "las operaciones irreversibles deben solicitar confirmación cuando corresponda" — pero sección 34 prohíbe esconderlo en un menú, así que la confirmación es un segundo clic en el mismo botón, no un modal |
| `react-resizable-panels` para el layout | `App.tsx` | Cubre "paneles redimensionables" (sección 1/17) real y probado; el *docking* flotante/arrastrable completo (sección 17) es una pieza de ingeniería aparte, no incluida aún |
| Nombre de proyecto `lumen-pro-ui` | raíz | No encontré un repo existente en memoria para este proyecto — asunción explícita, corrígeme si ya existe uno |

## 3. Qué queda deliberadamente fuera de esta entrega, y por qué

No es una lista de "TODO" vaga — es lo que el propio documento pide y no
está aquí, con el motivo concreto de por qué no se hizo ahora:

- **Motor DMX en Rust + drivers USB-DMX/Art-Net/sACN** (secciones 22, 31).
  Requiere compilación nativa y acceso a hardware serie/USB real para
  probarse; no es algo que se pueda validar en este entorno sandbox sin
  el dispositivo físico conectado.
- **Empaquetado Tauri** (sección 31). Tauri envuelve exactamente este
  frontend Vite — el proyecto ya está estructurado para ello — pero
  compilar el binario nativo y probar la ventana desktop necesita una
  máquina con GUI y toolchain de Rust, que este entorno no tiene.
- **Visualizer 2D/3D con Three.js/WebGL** (sección 6). Es un motor de
  render completo por sí mismo; el panel está *stubbed* como placeholder
  visible en el Dashboard para no bloquear el resto del layout.
- **Fixture Manager / Fixture Editor** con persistencia (secciones 9–10),
  **Scenes/Chases/Effects con lógica real** (secciones 11–13),
  **Live Mode separado** (sección 15), **Command Palette / atajos
  globales** (sección 26), **Audio Reactive** (sección 21 del sidebar) —
  todo esto es Fase 3 a 6 del propio plan del documento (sección 33) y
  depende de que exista el motor de estado de iluminación primero.
- **Doble monitor** (sección 25). Depende de la capa Tauri (gestión de
  ventanas nativas), no del frontend web.

## 4. Cómo correrlo

```bash
npm install
npm run dev       # http://localhost:1420
npm run build     # build de producción, verificado en esta sesión
npm run typecheck
```

## 5. Verificación (salida real de esta sesión)

```
npx tsc -b --noEmit   → sin errores
npm run build          → ✓ 42 modules transformed, built in 2.73s
```

## 6. Próximo paso recomendado (al cierre de la ronda 1)

Seguir la sección 33 en orden: **Fase 3 — Fixtures** (Fixture Manager +
Fixture Editor con persistencia local, probablemente SQLite vía Tauri
cuando se envuelva). Eso es lo primero que necesita un motor de estado
real, antes de Scenes/Chases.

---

## 7. Ronda 2 — Fase 3: Fixtures (Fixture Manager + Editor + Control)

Construida sobre las secciones 7, 8, 9 y 10 del documento original.

### 7.1 Qué se construyó

- **Modelo de datos real** (`src/types/fixture.ts`): `FixtureDefinition`
  (perfil: fabricante, modelo, canales, límites pan/tilt, flag
  `verified`) y `FixtureInstance` (unidad patcheada: universe, dirección,
  grupo). Cada `FixtureChannel` tiene nombre, tipo, rango DMX, valor por
  defecto, inversión, curva, presets y notas — exactamente lo que pide la
  sección 10.
- **Store con persistencia** (`src/lib/fixtureStore.tsx`): Context +
  `localStorage`. Es un placeholder deliberado y documentado en el propio
  código — cuando exista el motor Tauri+SQLite se reemplaza sin tocar los
  componentes, porque la forma de las acciones (`addInstance`,
  `updateDefinition`, etc.) no cambia.
- **Fixture Manager** (`src/components/fixtures/FixtureManager.tsx`):
  lista agrupada por modelo con contador, búsqueda, expandir para ver/
  editar instancias (universe/dirección inline), "+ ADD FIXTURE" — sobre
  el mock literal de la sección 9.
- **Fixture Editor** (`src/components/fixtures/FixtureEditor.tsx`): tabla
  de canales editable (nombre, tipo, min/max, default, curva, invertir,
  notas), agregar/quitar canales — permite crear un perfil sin biblioteca
  online, tal como exige la sección 10.
- **Fixture Control dinámico** (`src/components/fixtures/FixtureControl.tsx`):
  ya NO usa datos hardcodeados — lee los canales reales del fixture
  seleccionado y genera un `Fader` por canal, más la barra contextual de
  la sección 8 (`RGB/DIMMER/STROBE/MACROS` para un PAR RGB vs.
  `WHITE/COLOR/GOBO/PRISM/FROST/ZOOM/FOCUS/STROBE` para un beam),
  calculada a partir de qué tipos de canal existen en el perfil.
- **Corregido un bug real de la ronda 1**: `App.tsx` ignoraba la sección
  del Sidebar y siempre mostraba el Dashboard. Ahora enruta de verdad:
  Dashboard, Fixtures, y un `PlaceholderView` honesto para cada sección
  aún no implementada que indica a qué fase pertenece.

### 7.2 Datos semilla — y su límite real

Se sembró el store con **tu rig real** (memoria del proyecto): 2×
Orus 280W 3in1 y 4× Big Dipper LPC007. Antes de inventar el chart de
canales, busqué en la web:

- **Big Dipper LPC007**: confirmado que soporta modo de 3 y 7 canales,
  RGB 3-en-1 (54×3W). **No encontré el orden exacto de canales del modo
  7CH** en ninguna fuente confiable — la plantilla usa el orden estándar
  de la industria para PARs RGB (Master Dimmer/R/G/B/Strobe/Mode/Speed),
  pero no está verificado contra la hoja oficial.
- **"Orus" 280W 3in1**: no encontré esta marca en ningún manual público
  — es casi seguro un moving head genérico reetiquetado. La plantilla de
  16 canales usa el layout más común para beam/spot/wash de esta
  categoría, **sin verificar**.

Ambos perfiles quedan marcados `verified: false` con una nota visible en
el Fixture Manager ("SIN VERIFICAR") y las direcciones DMX de las 6
instancias sembradas son **secuenciales por defecto, no confirmadas** —
exactamente el paso que ya tenías pendiente (confirmar direcciones
contra la consola física MAX 512). Cuando lo hagas, corrige los canales
directamente en el Fixture Editor.

### 7.3 Qué sigue fuera, todavía, y por qué

- **Pan/Tilt como joystick/área XY** (recomendado en la tabla de la
  sección 7) — todos los canales usan `Fader` por ahora; el control XY
  dedicado es una pieza de UI aparte no construida en esta ronda.
- **Color wheel visual, selector de gobo con miniaturas, editor de
  curvas gráfico** (sección 7) — la tabla del Fixture Editor cubre la
  funcionalidad pero no la representación visual recomendada.
- **Persistencia real (Tauri + SQLite)** — sigue en `localStorage`, ver
  §3 de la ronda 1.
- Scenes, Chases, Effects, Groups siguen sin lógica (Fase 4).

### 7.4 Verificación (ronda 2)

```
npx tsc -b --noEmit   → sin errores
npm run build          → ✓ 50 modules transformed, built in 2.87s
```

## 8. Ronda 3 — Motor DMX en Rust (paso 2 del roadmap)

Siguiendo el orden ya acordado en `PASOS-PENDIENTES.md`, y dado que el
paso 1 (confirmar direcciones DMX contra la consola física MAX 512)
requiere el hardware delante y no se puede hacer de forma remota, se
avanzó al paso 2: el motor DMX en Rust, como crate independiente
(`dmx-engine/`) antes de envolverlo en Tauri.

### 8.1 Por qué un crate aparte y no directo en `src-tauri`

`src-tauri` todavía no existe (el empaquetado Tauri es el paso 3). Meter
el motor DMX suelto ahí habría significado inventar un `src-tauri`
mínimo solo para que compile — mezclando dos pasos del roadmap en uno.
En cambio, `dmx-engine/` es una librería Rust normal y corriente
(`cargo test`, `cargo run --bin smoke_test`) que **no depende de Tauri
para nada**. Cuando llegue el paso 3, se agrega como dependencia local
en el `Cargo.toml` de `src-tauri` (`lumenpro_dmx = { path = "../dmx-engine" }`)
y se exponen sus funciones como comandos Tauri (`connect`, `set_channel`,
`disconnect`, etc.) — trabajo aparte, no hecho todavía.

### 8.2 Qué hay adentro

- `src/universe.rs` — `DmxUniverse`: buffer de 512 canales (1-indexado,
  igual que la consola y que el campo `index` de `fixtureLibrary.ts`),
  compartible entre hilos con `Arc<RwLock<...>>`.
- `src/output.rs` — trait `DmxOutput` + dos implementaciones:
  - `MockOutput`: no toca hardware, para desarrollar Scenes/Chases/Effects
    y probar el motor sin el Enttec ni la MAX 512 conectados.
  - `EnttecUsbProOutput`: driver real para el **Enttec DMX USB PRO** (o
    compatibles), sobre el crate `serialport`. El framing de paquete
    (`0x7E`, label `0x06` "Output Only Send DMX Packet", longitud
    little-endian, start code `0x00`, `0xE7` de cierre) está tomado del
    formato público de la Enttec DMX USB PRO API Specification 1.44,
    documentado también por OLA/DMXKing.
- `src/engine.rs` — `DmxEngine`: hilo de salida a FPS configurable
  (30-40 típico) que lee el `DmxUniverse` en cada tick y lo manda por el
  `DmxOutput` activo. `start()`/`stop()` limpios, `Drop` para no dejar
  hilos huérfanos.
- `src/bin/smoke_test.rs` — prueba manual: `cargo run --bin smoke_test`
  (Mock) o `cargo run --bin smoke_test /dev/ttyUSB0` / `COM5` (Enttec
  real) — sube el dimmer de las 6 direcciones ya sembradas en
  `fixtureLibrary.ts` (Orus #1/#2, LPC007 #1-4) 3 segundos y hace blackout.

### 8.3 Verificado de verdad vs. no verificado — sé preciso acá

**Verificado en este sandbox** (Ubuntu, Rust 1.75 vía apt, sin GUI ni
hardware DMX):

```
cargo build   → compila limpio (serialport 4.3.0 + libudev-dev)
cargo test    → 8/8 tests pasan (universo, framing de paquete Enttec,
                motor enviando frames a la frecuencia configurada)
cargo run --bin smoke_test   → corre extremo a extremo contra MockOutput,
                sube y baja dimmers, hace blackout, sin errores
```

**NO verificado — no tengo cómo, y no voy a fingir que sí:**

- El driver `EnttecUsbProOutput` **nunca tocó un Enttec real** ni ningún
  otro widget compatible. El framing de paquete es correcto contra la
  especificación pública, pero variantes de firmware o clones baratos
  (Eurolite, DMXKing, etc.) a veces difieren en detalles. Antes de
  usarlo en un show, probalo primero con ENTTEC EMU o QLC+ para
  descartar un problema de cableado/driver del sistema operativo, y
  después con `smoke_test <puerto>`.
- No hay reconexión automática si se desconecta el USB a mitad de show
  — eso queda para cuando se integre en Tauri (paso 3), donde sí tiene
  sentido exponerlo como estado observable por la UI.
- Solo soporta 1 universo. Está bien para tu rig actual (6 fixtures,
  ~55 canales), pero si en algún momento sumás fixtures que crucen el
  canal 512 vas a necesitar un segundo universo — no contemplado todavía.

### 8.4 Pendiente inmediato relacionado

- Instalar Rust localmente (`rustup`, no estaba disponible por defecto
  en este sandbox tampoco — se instaló vía `apt install rustc cargo`
  como salida rápida, pero para desarrollo real conviene `rustup` por
  versiones más nuevas y `cargo tauri` cuando llegue el paso 3).
- Cuando tengas el Enttec (o el que sea) a mano: `cargo run --bin
  smoke_test <puerto>` y confirmá que las 6 luces responden en las
  direcciones sembradas — ahí mismo aprovechás para hacer el paso 1
  pendiente (verificar direcciones reales contra la MAX 512) y corregir
  `fixtureLibrary.ts` si hace falta.
