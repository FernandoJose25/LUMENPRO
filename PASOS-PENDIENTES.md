# LUMENPRO — Pasos pendientes

> Repo: https://github.com/FernandoJose25/LUMENPRO — rama `main` ya sincronizada.

## ✅ Completado

- Fase 1 — Design System (tokens, Button, Panel, Fader, Tabs, StatusIndicator)
- Fase 2 — Workspace shell (Sidebar, Topbar, Blackout real, paneles redimensionables)
- Fase 3 (parcial) — Fixture Manager, Fixture Editor, Fixture Control dinámico
- **Live Mode** (`components/live/LiveView.tsx`) y **Command Palette**
  (`components/command-palette/CommandPalette.tsx`, atajo Ctrl/Cmd+K) —
  detalle completo más abajo, en "Pendiente — Visualizer y extras"
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
  **`cargo check` de `src-tauri` verificado en Windows con Rust 1.96**
  (2026-11-17), con los iconos generados desde `src-tauri/icons/logo.svg`.
  El CI lo repite en `windows-latest` en cada push.
- **Motor independiente** (2026-11-25): momentos, chases, effects, fades y los
  canales que salen están en Rust (`show-engine/`), sin hilos ni reloj propios.
  En la app corren en otro proceso (`src-tauri/src/engine/`: motor, guardián que
  lo levanta si se cae, celular y vigilancia de la ventana); en el navegador y
  en los tests, el mismo código en WASM. La ventana (`lib/engineLink.ts`) es un
  espejo: si se traba 15 s o se cae con luces encendidas, el motor abre otra.
  Al cerrarla con luces pregunta si dejarlas. Si se cae el motor, retoma de
  `session.json`. Probado con el `.exe`: ventana trabada, matada y cerrada en
  plena hora loca, señal sin pausas de más de 34 ms y celular andando.
- **Biblioteca de QLC+** (2026-11-25): 1781 perfiles y 5234 modos de QLC+ 5.3.1
  en `public/library`, y 584 gobos en `public/gobos`. Se generan con
  `scripts/import-qlcplus.mjs` y se comparan canal por canal con los originales
  con `scripts/verify-library.py` (0 diferencias). Buscador y modo en Fixtures →
  "+ Elegir de la biblioteca"; cambiar de modo conserva los ids de canal. Ámbar,
  UV, CMY, HSV, canales finos, barras por foco (effects y simulador), dimmer
  general y por foco. El humo no sigue la intensidad ni "Identificar". El
  simulador muestra color, gobo, prisma, zoom, iris y recorrido real.
- **Art-Net, sACN y varios universos** (2026-11-25): `dmx-engine/src/network.rs`.
  Varias salidas a la vez (cable, Enttec, Art-Net, sACN, simulada), cada una con
  su universo; buscar nodos Art-Net; sección "Universes" con los 512 canales.
  Verificado con receptores de terceros (librerías `sacn` y `stupidArtnet` de
  Python): 512 canales iguales, 40 FPS. **Falta con un nodo real**, y la búsqueda
  de nodos solo se probó con respuestas armadas según la norma.
- **Movimientos y paletas** (2026-11-26): effects de figura (círculo, ocho,
  línea, abanico) con tamaño en grados, giro, desfase y música; se suman encima
  de la posición sin tocar los faders, abren y cierran suave y respetan el
  recorrido. Sección "Paletas" (posiciones, colores, gobos y haz): las escenas
  guardan qué paleta tenía cada luz y la siguen si se corrige. En Escenario,
  "Apuntar" lleva las cabezas a donde se toca el piso. La plantilla usa figuras.
- **MIDI y pantallas a medida** (2026-11-26): controladores MIDI en el proceso
  del motor (`src-tauri/src/engine/midi.rs`, con midir): se detectan solos, se
  asigna un botón o fader moviéndolo ("Aprender") y los botones que encienden
  algo se iluminan en el controlador. "Mis botones" en Live y botones propios en
  el celular, con la misma lista de acciones. Probado con el `.exe` y un
  controlador virtual (mensajes inyectados por el mismo camino): un evento
  entero, también con la ventana cerrada. **Falta con un controlador real.**
- **Publicar** (2026-11-26): versión 0.2.0; `.github/workflows/release.yml` arma
  y publica el instalador al subir una etiqueta `v*`; la app avisa si hay una
  versión nueva en GitHub. Guía para quien nunca lo usó en `docs/GUIA.md` (y en
  la sección "Guía"). Video del simulador en `docs/video/simulador.mp4`.
  Licencia por ahora "todos los derechos reservados" (lo más fácil de abrir
  después); **la decide el dueño**.
- **Diálogos propios** (`lib/dialogs.ts`): los de Windows congelaban la interfaz.
- **Salida DMX conectada a la interfaz** (2026-11-24): driver del cable FTDI
  (`OpenDmxOutput`: 250 kbaudios, 8N2, BREAK por software, 30 FPS), estado real
  y reconexión automática en `DmxEngine`, sección "DMX Output" (puerto COM,
  aviso de CH340, monitor de canales, choques de direcciones) y `dmxFrame.ts`
  como único lugar donde los valores se vuelven canales. **Sin probar contra
  hardware real.**
- **Blackout en la salida**: ya no pone `liveValues` a 0. Apaga dimmer, color y
  programas automáticos en `dmxFrame.ts`, sin mover Pan/Tilt; ningún chase o
  effect lo pisa y al quitarlo todo vuelve igual. Pedir una escena lo quita.
- **Momentos del evento** (2026-11-24): `types/moment.ts`, sección "Momentos",
  barra en Live con Siguiente/Anterior/Detener, AvPág/RePág (pasador de
  diapositivas) y plantilla de quinceañera por tipo de canal. Al entrar, lo que
  la escena no define vuelve a su default; los effects arrancan al terminar el
  fade. En los fades, estrobo/gobo/rueda de color saltan (`lib/fade.ts`).
- **Control por celular** (2026-11-24): `src-tauri/src/engine/remote.rs` (HTTP
  en el puerto 8777, PIN con bloqueo por intentos, token persistente en
  `remote.json`) sirve `remote.html` y le pasa las órdenes al motor. Sección "Celular" con QR. Apagado por defecto. Va sin cifrar: usar
  una WiFi propia. **Sin probar con un celular real** (sí con Chromium móvil).
- **Intensidad y estrobo generales** en la salida (`dmxFrame.ts`), en Live y en el
  celular. El estrobo usa el preset "Estrobo" de cada canal; en cabezas sin ese
  preset no hace nada.
- Mientras sale DMX la laptop no se suspende, y al abrir la app reconecta sola
  al último adaptador.
- **Simulador** (2026-11-24): `lib/stage.ts` (geometría y cámara propias) y
  `components/stage/`. Sección "Escenario" para ubicar las luces; en el Dashboard
  reemplaza al visualizer de puntos. No simula gobos ni prisma. `panInvert` y
  `tiltInvert` de cada unidad ya se aplican en la salida.
- **Identificar canales** (`ChannelFinder`): barrer, asignar función, valor inicial
  y presets. "+ Equipo sin manual" crea N canales en direcciones libres. En DMX
  Output, "Identificar" enciende una luz 3 s y "Velocidad" ajusta los FPS.
- **Colores y presets** de un toque (`ColorSwatches`) en Fixture Control, Groups y
  Live; reemplazan la barra decorativa.
- **Número de canal editable** en Fixture Editor: mueve la función sin romper
  escenas (guardan el id del canal, no su posición).
- **Audio Reactive** (2026-11-24): `lib/audioInput.ts` (niveles por banda
  ajustados al volumen del local) y `lib/beatTracker.ts` (tempo por
  autocorrelación, reloj de golpes que predice). Effects con "Sigue a": tiempo
  fijo, ritmo, graves, medios o agudos; onda "Golpe". Sin música o sin ritmo
  reconocido siguen con su velocidad. La plantilla trae "Hora loca con música".
  Probado con audio simulado en Chromium y en la app; **falta con música real**.
  El micrófono se autoriza en `main.rs` (`on_permission_request`).
- **Deshacer y rehacer** (`lib/history.ts`): fixtures, escenas, grupos, chases,
  effects y momentos. Los valores en vivo quedan fuera a propósito.
- **Pad de pan/tilt** (`PanTiltPad`, 16 bits) en Fixture Control, Groups y Live.
- **Curvas** de dimmer y color aplicadas en `dmxFrame.ts`.
- **Segundo monitor**: `stage_window.rs` + `lib/stageMirror.ts` (BroadcastChannel;
  la segunda ventana no tiene store). Falta verlo con dos monitores conectados.
- Topbar sin datos inventados: se quitaron CPU y nombre de show; los BPM son los
  de la música.
- **Show en disco** (`show.json` en AppData, escritura atómica) con exportar e
  importar en "Settings". `npm run tauri build` genera el instalador.

## 🔲 Pendiente — Fase 3 (cerrar Fixtures)

- [ ] **Confirmar direcciones DMX reales** de las 6 instancias sembradas
      (2x Orus 280W, 4x Big Dipper LPC007) contra la consola física MAX 512
      — hoy están secuenciales sin verificar
- [x] Orden de canales del Big Dipper LPC007 modo 7CH — coincide con el perfil
      Betopper LPC-007 de QLC+. Falta probarlo contra la lámpara
- [ ] Verificar el modo y los canales del "Orus" 280W en el menú del equipo:
      hay documentos que dicen 16, 18 y 26/32. El estrobo por defecto es 255
      (abierto) por analogía con dos cabezas 10R, sin confirmar
- [ ] Agregar la barra LED móvil con "+ Equipo sin manual" (modelo por identificar)
- [x] Control XY dedicado para Pan/Tilt
- [x] Selector de gobo con miniaturas (en los equipos de la biblioteca)
- [x] Curvas de canal aplicadas en la salida

## ✅ Fase 4 — Scenes / Groups / Chases / Effects (completa, ver detalle abajo)

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
      fixtures. La entrada "Scenes" del Sidebar (antes caía en
      PlaceholderView aunque la lógica ya existía) ahora abre
      `components/scenes/ScenesView.tsx`, el mismo panel con más espacio y
      `FixtureControl` al lado. `npm run typecheck` y `npm run build`
      verificados OK. **Verificado con tests de integración reales** (ver
      abajo, `npm test`) — guardar/recuperar/re-grabar/borrar simulados con
      clics de usuario de verdad (`@testing-library/user-event`), no solo
      lectura de código.
- [x] **Chases** (secuencias de escenas con tiempos/crossfade). Nuevo
      `types/chase.ts` (`Chase { steps: ChaseStep[], loop }`, cada
      `ChaseStep` referencia una `Scene` real por `sceneId` — no duplica
      valores de canal, así que editar una escena después actualiza a
      todos los chases que la usan). `fixtureStore` agrega CRUD completo
      (`addChase`, `renameChase`, `removeChase`, `setChaseLoop`,
      `addChaseStep`, `removeChaseStep`, `updateChaseStep`,
      `moveChaseStep`). Motor de reproducción nuevo en
      `lib/chasePlayer.ts` (`useChasePlayer`): corre en el navegador
      (`setInterval` a ~25fps, no hay motor DMX conectado al frontend
      todavía — ver AUDIT.md §8), interpola linealmente `liveValues` desde
      el valor en vivo actual (no desde un valor "teórico" del step
      anterior) hasta el objetivo de cada escena, con fade + hold
      independientes por step. Nueva vista `components/chases/ChasesView.tsx`
      — antes "Chases" en el Sidebar caía en PlaceholderView: panel
      izquierdo crea/renombra/borra chases; panel derecho edita la
      secuencia (elegir escena de un `<select>`, ajustar fade/hold en ms,
      reordenar ↑↓, quitar step) con controles ▶ Reproducir / ■ Detener,
      toggle de Loop e indicador de progreso en vivo (step/fase/%).
      `npm run typecheck` y `npm run build` verificados OK.

      **Verificado con tests de integración reales** (`npm test`, 5 tests
      en `src/test/chases.test.tsx`): crear chase + agregar steps con
      tiempos por defecto, reordenar invierte la secuencia, quitar step,
      toggle de loop persiste, y el test más importante — reproducir con
      timers controlados (`vi.useFakeTimers`) y confirmar matemáticamente
      que el valor interpola a mitad de camino, llega exacto al valor
      objetivo al terminar cada fade, y que detener congela el valor en
      vez de seguir animando.

      **Bug real encontrado y arreglado en el proceso** (no solo de
      tests): `addChase`/`addGroup` (y `saveScene`, corregido por las
      dudas) devolvían el objeto recién creado leyendo una variable que
      se asignaba *dentro* del callback de `setState`, asumiendo que React
      ejecuta ese callback de forma síncrona antes de que la función
      retorne. Esa suposición no está garantizada por React, y de hecho
      fallaba en un caso de uso real: mover un fader y guardar una escena
      justo antes de crear un chase. El fix: construir el objeto completo
      *antes* de llamar a `setState`, no depender de la ejecución síncrona
      del updater. Este bug pudo haber estado latente en Groups desde el
      commit anterior sin que ningún test lo detectara — los tests de
      Groups nunca probaron crear un grupo *después* de otras acciones en
      el mismo tick.

      Sigue pendiente: Effects (generadores paramétricos). Chases no
      soporta todavía "empezar desde el step N" ni click para saltar a un
      step específico durante la reproducción — solo Reproducir desde el
      principio y Detener.
- [x] **Effects** (generadores paramétricos). Nuevo `types/effect.ts`
      (`Effect { groupId, channelType, waveform, speedCpm, min, max,
      phaseOffsetDeg }`, 4 formas de onda: seno/cuadrada/diente de
      sierra/triangular). A diferencia de Chases (que salta entre valores
      fijos de escenas guardadas), un Effect genera valores continuamente
      sin necesitar escenas previas — apunta siempre a un Group y a un
      `ChannelType` (mismo patrón que `setGroupChannelByType`).
      `fixtureStore` agrega CRUD (`addEffect`, `renameEffect`,
      `removeEffect`, `updateEffect`) más `startEffect`/`stopEffect`, que
      solo tocan `runningEffectIds` — una lista que **deliberadamente NO
      se persiste** entre recargas de página (no hay nada real corriendo
      detrás, sin motor DMX conectado al frontend — ver AUDIT.md §8).

      Motor de reproducción nuevo en `lib/effectEngine.ts`
      (`useEffectsEngine`): a diferencia de `useChasePlayer` (un hook por
      vista, activo solo mientras esa pantalla está abierta), este es **un
      único intervalo global** que recorre todos los efectos corriendo en
      cada tick — se monta una sola vez en `App.tsx` (no en
      `EffectsView`), así un efecto sigue animando aunque el usuario
      navegue a otra sección del Sidebar, igual que en una consola real.
      Cada fixture del grupo recibe un desfase de fase según su posición
      en el array de instancias (`phaseOffsetDeg`), para efectos tipo
      "ola" recorriendo el grupo.

      Nueva vista `components/effects/EffectsView.tsx` — antes "Effects"
      en el Sidebar caía en PlaceholderView: panel izquierdo crea/
      renombra/borra effects; panel derecho edita grupo objetivo, tipo de
      canal, forma de onda, velocidad (ciclos/min), rango min/max y
      desfase de fase, con ▶ Reproducir / ■ Detener (deshabilitado sin
      grupo asignado). `npm run typecheck` y `npm run build` verificados
      OK.

      **Verificado con 4 tests de integración reales**
      (`src/test/effects.test.tsx`, 18/18 en total con las suites
      anteriores): defaults al crear, el botón Reproducir se habilita
      solo con grupo asignado, borrar un effect que estaba corriendo lo
      saca de `runningEffectIds`, y el test más importante — reproducir
      una onda cuadrada con timers controlados y confirmar
      matemáticamente que alterna entre max y min en el instante exacto
      del medio ciclo, y que Detener congela el valor. Nota técnica de
      testing: el motor registra su `setInterval` al *montarse* (no al
      arrancar un effect en particular), así que los timers falsos deben
      activarse ANTES de renderizar el árbol de componentes — si no,
      `vi.advanceTimersByTime` no le hace nada a un intervalo ya
      registrado con el `setInterval` real.

      Pendiente: no hay preview visual de la forma de onda en la UI (solo
      números), y con múltiples efectos corriendo sobre el mismo tipo de
      canal en fixtures compartidos, el último que corre en el loop del
      motor "gana" en ese tick (no hay mezcla/prioridad entre efectos
      superpuestos).
- [x] **Groups** — entidad de primera clase. Nuevo `types/group.ts`
      (`Group { id, name, color }`) y `FixtureInstance.group` pasa de string
      libre sin usar a guardar siempre un `Group.id` real. `fixtureStore`
      agrega CRUD de grupos (`addGroup`, `renameGroup`, `removeGroup`,
      `setInstanceGroup`) y `setGroupChannelByType` — escribe un valor a
      todos los fixtures del grupo que tengan un canal de ese tipo
      (Dimmer, Color, etc.), resuelto por `ChannelType` porque cada modelo
      puede tener ese canal en un índice DMX distinto (LPC007 vs Orus).
      Nueva vista `components/groups/GroupsView.tsx` — antes "Groups" en el
      Sidebar caía en PlaceholderView, ahora: panel izquierdo para
      crear/renombrar/borrar grupos y marcar qué fixtures pertenecen a cada
      uno (checkbox list); panel derecho "Group Control" con un fader por
      cada tipo de canal presente en el grupo, que aplica a todos los
      miembros a la vez (es un control de escritura tipo "master de grupo",
      no un espejo del valor actual de cada fixture). Borrar un grupo
      desagrupa a sus fixtures, no los borra. `npm run typecheck` y
      `npm run build` verificados OK. **Verificado con tests de integración
      reales** (`npm test`): crear grupo, cancelar el prompt, asignar/
      desasignar fixture, mover el fader de Group Control y confirmar que
      escribe en `liveValues`, borrar grupo sin borrar fixtures. **Sin
      probar en un navegador de verdad** (esto es Node+jsdom, no Chrome) ni
      con más de un grupo simultáneo en pantalla a la vez — sigue siendo
      recomendable que lo abras tú una vez. Scenes/Chases todavía NO usan
      el grupo para acotar su alcance (guardar una escena sigue capturando
      todo `liveValues` tocado, sin filtrar por grupo) — eso queda
      pendiente si hace falta "escena solo para el grupo X".
- [x] **Tests de integración** (`npm test`, Vitest + Testing Library +
      jsdom) — `vitest.config.ts` separado de `vite.config.ts` (para no
      mezclarlo con la config de Tauri), `src/test/setup.ts` con cleanup
      automático entre tests. `src/test/groups.test.tsx` (5 tests) y
      `src/test/scenes.test.tsx` (4 tests), 9/9 pasan. Simulan clics reales
      de usuario (`@testing-library/user-event` + `fireEvent`), no solo
      llaman funciones del store directamente — el objetivo era responder
      "¿esto realmente funciona si alguien le hace clic?", no solo "¿tipa
      bien?". **Sigue siendo jsdom, no un navegador real** — no prueba
      CSS/layout/drag real del `Fader` (el pointer-drag del slider no se
      testeó, solo la entrada numérica, que es la vía "para valores
      exactos" que ya pedía la sección 27 del brief original) ni cómo se
      ve/siente de verdad. Cero cobertura todavía de `FixtureManager`,
      `FixtureEditor`, `Sidebar`/`Topbar`, ni del motor DMX en Rust más
      allá de sus propios `cargo test` (que son un suite aparte).

## 🔲 Pendiente — Motor y hardware

- [x] Motor DMX en Rust — crate `dmx-engine/`, integrado a `src-tauri`.
- [x] Drivers USB-DMX — cable FTDI (Open DMX) y Enttec DMX USB PRO sobre
      `serialport`. Art-Net/sACN sigue sin hacer.
- [ ] **Probar con el cable y las luces**: `cargo run --bin smoke_test COM5`
      (en `dmx-engine/`) y luego la app. Revisar parpadeo.
- [x] Empaquetado Tauri — `npm run tauri build` genera el `.exe`.
- [x] Momentos del evento con "Siguiente" (escena + chase + effects en un botón)
- [x] Buscador de canales (subir de a uno para identificar un equipo sin manual)
- [x] Control por celular (página por WiFi local con PIN)
- [ ] Probar el celular real en la WiFi del evento (firewall de Windows)
- [x] Doble monitor (simulador en otra ventana)

## 🔲 Pendiente — Visualizer y extras

- [x] **Visualizer 2D** — primera versión funcional en
      `components/visualizer/StageVisualizer.tsx`, ya no es un placeholder
      vacío. Cada fixture del rig es un punto de luz cuyo color (RGB si el
      fixture los tiene) y brillo (canal Dimmer) reflejan `liveValues` EN
      VIVO — ahora que Scenes/Chases/Effects escriben ahí de verdad, el
      Visualizer tiene algo real y dinámico que mostrar. El anillo del
      punto usa el color del Group si el fixture está agrupado.
      **Alcance acotado deliberadamente**: layout automático ordenado por
      dirección DMX (fila/grid), NO posicionamiento manual tipo "planta
      de escenario", y sin vista 3D — eso queda pendiente. `npm run
      typecheck` y `npm run build` verificados OK. **Sin tests
      automatizados para este componente todavía** (a diferencia de
      Scenes/Groups/Chases/Effects) — es puramente visual/derivado de
      `liveValues` ya testeado en los otros suites, el riesgo de bugs de
      lógica es bajo, pero sigue sin cobertura propia.
- [x] **Live Mode** — pantalla de operación separada de edición (sección
      "Live" nueva en el Sidebar, `components/live/LiveView.tsx`). No hay
      crear/editar/borrar acá — todo lo que expone ya existía como lógica
      real en fixtureStore/chasePlayer/effectEngine (Fase 4), esto solo lo
      junta con controles grandes pensados para tocarse rápido durante un
      show: recall de Scenes, selector + ▶ Reproducir/■ Detener de un
      Chase (mismo `useChasePlayer` que ChasesView, montado localmente
      acá — sigue existiendo un solo motor de chase activo a la vez, ver
      limitación ya documentada arriba en Chases), toggle ▶/■ por Effect
      (usa el motor global de `effectEngine.ts`, así que Live Mode y
      EffectsView ven y controlan el mismo estado), y un fader master por
      tipo de canal para cada Group.

      **Bug real cerrado en el proceso, no solo nueva UI**: el botón
      Blackout de la Topbar existía desde Fase 2 pero no hacía nada («Sin
      motor DMX todavía» en el comentario original). Se agregó
      `fixtureStore.blackout()` — pone a 0 TODO canal de TODO fixture
      patcheado (no solo los ya tocados, a diferencia de guardar una
      Scene) y vacía `runningEffectIds` — y ahora tanto la Topbar como el
      botón grande de Live Mode llaman a la misma acción (una sola fuente
      de verdad, no dos implementaciones). Como consecuencia, `App.tsx` se
      reorganizó: el estado de sección y el render de
      Topbar/Sidebar/vistas se movió a un nuevo componente `AppShell`
      (hijo de `FixtureStoreProvider`), porque `App()` en sí no puede leer
      el contexto que él mismo está montando — mismo motivo por el que ya
      existía `EffectsEngineMount`.

      Nota: el Blackout descrito aquí se reemplazó el 2026-11-24 por uno
      que apaga en la salida (ver "Completado"). Ya no hace falta detener
      el Chase aparte.

      `npm run typecheck` y `npm run build` verificados OK. **Verificado
      con 5 tests de integración reales** (`src/test/live.test.tsx`):
      recuperar una escena desde Live Mode aplica sus valores, toggle de
      effect actualiza `runningEffectIds`, mover el fader master de un
      grupo escribe en `liveValues` del miembro, Blackout apaga el rig Y
      para los effects corriendo, y reproducir/detener un chase desde
      Live Mode (reusando el chase creado con la UI real de ChasesView vía
      `rerender` de Testing Library, para no montar dos motores de chase
      del mismo chase a la vez en el mismo test).

- [x] **Command Palette** — atajo global Ctrl/Cmd+K (funciona parado en
      cualquier sección, `components/command-palette/CommandPalette.tsx`,
      montado una sola vez en `AppShell`), Esc cierra, ↑/↓ navega, Enter
      ejecuta el resaltado. Comandos: "Ir a &lt;sección&gt;" por cada
      entrada del Sidebar (`SECTIONS` ahora se exporta desde
      `Sidebar.tsx` para no duplicar la lista), "Recuperar escena
      &lt;nombre&gt;" por cada Scene, "Reproducir/Detener effect
      &lt;nombre&gt;" por cada Effect (mismo motor global que Live Mode y
      EffectsView), y Blackout.

      Deliberadamente NO incluye "reproducir chase X" como comando
      global — a diferencia de Effects, Chases no tiene un motor único:
      se reproduce con un `useChasePlayer` local a quien lo abre
      (ChasesView o LiveView), así que no hay un "chase actualmente en
      reproducción" que un comando global pueda controlar desde cualquier
      pantalla. El comando de navegación a Chases sigue disponible.

      Hay un botón flotante abajo a la derecha ("Ctrl+K Comandos" / "⌘K
      Comandos" en Mac) para quien no conozca el atajo — la paleta no
      depende únicamente de saberse la combinación de teclas.

      `npm run typecheck` y `npm run build` verificados OK. **Verificado
      con 4 tests de integración reales**
      (`src/test/commandPalette.test.tsx`): abrir con Ctrl+K y cerrar con
      Esc, un comando "Ir a X" navega y cierra la paleta sola, recuperar
      una escena desde un comando aplica sus valores, y Blackout desde un
      comando apaga el rig.

- [x] Audio Reactive

## Orden recomendado

1. Confirmar direcciones DMX y canales reales (bloquea todo lo demás con hardware)
2. ~~Motor DMX en Rust + driver USB-DMX~~ — hecho, sin probar contra hardware
3. ~~Envolver en Tauri~~ — hecho, la interfaz envía DMX y genera el `.exe`
4. Scenes (hecho) → Groups (hecho) → Chases (hecho) → Effects (hecho)
5. Simulador con posiciones y haces (hecho)
6. Live Mode (hecho) → Command Palette (hecho) → Audio Reactive (hecho) →
   doble monitor (hecho)
