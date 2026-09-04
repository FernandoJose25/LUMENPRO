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
4. Scenes (hecho) → Groups (hecho) → Chases (hecho) → Effects (hecho)
5. Visualizer 2D/3D
6. Resto de pulido (Live Mode, Command Palette, Audio Reactive, doble monitor)
