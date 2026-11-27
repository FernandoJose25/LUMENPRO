import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Scene } from "@/types/scene";
import type { Group } from "@/types/group";
import { GROUP_COLORS } from "@/types/group";
import type { Chase, ChaseStep } from "@/types/chase";
import type { Effect } from "@/types/effect";
import type { Moment } from "@/types/moment";
import type { Timeline } from "@/types/timeline";
import type { PlaylistSong } from "@/types/music";
import { SPECIAL_KINDS, type Special, type SpecialKind } from "@/types/special";
import { engineNow, noteEngineNow } from "@/lib/engineClock";
import type { Palette, PaletteKind } from "@/types/palette";
import type { Action, Control, Pad } from "@/types/controls";
import {
  capture,
  colorMembers,
  colorPaletteValues,
  heldValues,
  matchPalettes,
  paletteValues,
  quickColors,
  tintedGroups,
  type QuickColor,
} from "@/lib/palettes";
import { colorValues } from "@/lib/look";
import { withTwins } from "@/lib/dmxFrame";
import { ORUS_WHEEL, ORUS_WHEEL_NOTE, seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import { buildQuinceTemplate } from "@/data/quinceTemplate";
import { catalogUpdate, missingPresets } from "@/lib/effectPresets";
import { resetTemplate } from "@/lib/factory";
import { closeWindow, createEngineLink, type EngineHost, type EngineLink } from "@/lib/engineLink";
import { askChoice } from "@/lib/dialogs";
import type { ChannelValues } from "@/lib/fade";
import { docOf, EMPTY_HISTORY, recordChange, sameDoc, travel, type ShowDoc } from "@/lib/history";
import { STORAGE_KEY, writeShow } from "@/lib/showFile";
import type { EngineChanges, EngineDoc, EngineMessage, Playback } from "@/types/engine";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Con un Effect corriendo el estado cambia 25 veces por segundo: se guarda
// como mucho una vez por segundo en vez de escribir a disco en cada tick.
const PERSIST_EVERY_MS = 1000;

/**
 * Lo programado (ShowDoc) es de la interfaz y se le manda al motor; lo que está
 * pasando (Playback y liveValues) es del motor y acá hay un espejo para
 * mostrarlo (ver lib/engineLink.ts).
 */
interface FixtureStoreState extends ShowDoc, Playback {
  /** La primera de las elegidas (la que se muestra si se ve solo una). */
  selectedInstanceId: string | null;
  /** Las que mueve Fixture Control, todas a la vez. */
  selectedInstanceIds: string[];
  /** Valores de canal en vivo: instanceId -> channelId -> valor. Blackout,
   *  intensidad y estrobo generales NO los tocan: se aplican en la salida, así
   *  nada puede pisarlos y al quitarlos todo vuelve como estaba. */
  liveValues: ChannelValues;
  /** Cabezas dibujando una figura, según el motor. No se guarda. */
  moving: ChannelValues;
}

// Se recalculan solo cuando cambian las luces, no en cada edición.
let colorsCache: { of: [unknown, unknown]; colors: QuickColor[] } | null = null;

/** Lo que se le manda al motor: lo programado y los colores fijos. */
export function engineDoc(s: ShowDoc): EngineDoc {
  if (colorsCache?.of[0] !== s.instances || colorsCache.of[1] !== s.definitions) {
    colorsCache = { of: [s.instances, s.definitions], colors: quickColors(s) };
  }
  return { ...docOf(s), colors: colorsCache.colors };
}

/** Lo que no se guarda con el show: al abrir, nada arranca solo. La excepción
 *  son activeSceneId y activeMomentId ("Siguiente" retoma desde ahí). */
const IDLE: Omit<Playback, "activeSceneId" | "activeMomentId"> = {
  runningEffectIds: [],
  blackoutActive: false,
  master: 100,
  strobeActive: false,
  identifyId: null,
  momentRun: null,
  chase: null,
  heldColors: {},
  timeline: null,
  tapBpm: null,
  speed: 100,
  firing: {},
  armed: {},
  djBpm: null,
};
const NOT_SAVED = new Set([...Object.keys(IDLE), "moving"]);

interface FixtureStoreValue extends FixtureStoreState {
  engine: EngineLink;
  selectedInstance: FixtureInstance | null;
  selectedDefinition: FixtureDefinition | null;
  /** Las elegidas, en el orden del rig. */
  selectedInstances: FixtureInstance[];
  /** Elige solo esa. */
  selectInstance: (instanceId: string | null) => void;
  /** Elige varias a la vez. */
  selectInstances: (instanceIds: string[]) => void;
  addDefinition: (def: FixtureDefinition) => void;
  updateDefinition: (def: FixtureDefinition) => void;
  removeDefinition: (defId: string) => void;
  addInstance: (instance: FixtureInstance) => void;
  updateInstance: (instance: FixtureInstance) => void;
  removeInstance: (instanceId: string) => void;
  /** Valor efectivo de un canal: lo capturado en liveValues, o si nunca se
   *  tocó, el defaultValue del perfil (mismo fallback que tenía antes el
   *  useState local de FixtureControl). */
  getChannelValue: (instanceId: string, channelId: string, fallback: number) => number;
  setChannelValue: (instanceId: string, channelId: string, value: number) => void;
  /** Varios canales en una sola actualización (merge). */
  setChannelValues: (values: ChannelValues) => void;
  saveScene: (name: string) => Scene;
  /** Captura de las luces dadas los canales de esa clase. */
  addPalette: (kind: PaletteKind, name: string, instances: FixtureInstance[]) => Palette;
  /** Un color para todas las luces que puedan ponerlo. */
  addColorPalette: (name: string, hex: string) => Palette;
  /** Vuelve a capturar lo que tienen ahora sus luces. */
  updatePalette: (paletteId: string) => void;
  renamePalette: (paletteId: string, name: string) => void;
  /** Las escenas que la usaban se quedan con sus valores. */
  removePalette: (paletteId: string) => void;
  applyPalette: (paletteId: string, instances: FixtureInstance[]) => void;
  setLivePads: (pads: Pad[]) => void;
  setPhonePads: (pads: Pad[]) => void;
  setControls: (controls: Control[]) => void;
  /** Un botón (press: al apretar true, al soltar false) o un fader (0–1). */
  act: (action: Action, press?: boolean, value?: number) => void;
  /** Lo que pone el color fijo en cada luz (ver heldColors). */
  held: ChannelValues;
  /** Color fijo para un grupo ("" = sin grupo; null = todos); sin color, se
   *  suelta y vuelve el del momento. */
  holdColor: (groupId: string | null, hex: string | null) => void;
  updateSceneValues: (sceneId: string) => void;
  renameScene: (sceneId: string, name: string) => void;
  removeScene: (sceneId: string) => void;
  recallScene: (sceneId: string) => void;
  addGroup: (name: string) => Group;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => void;
  /** Asigna un fixture a un grupo, o lo desagrupa si groupId es null.
   *  Un fixture solo puede estar en un grupo a la vez (ver types/group.ts). */
  setInstanceGroup: (instanceId: string, groupId: string | null) => void;
  /** Escribe el mismo valor de canal en todos los fixtures de un grupo que
   *  tengan un canal de ese `ChannelType` (p. ej. "sube el Dimmer de todo
   *  el grupo a 200" sin importar en qué índice de canal esté el Dimmer
   *  de cada fixture — LPC007 y Orus no lo tienen en el mismo índice). */
  setGroupChannelByType: (groupId: string, channelType: string, value: number) => void;
  addChase: (name: string) => Chase;
  renameChase: (chaseId: string, name: string) => void;
  removeChase: (chaseId: string) => void;
  setChaseLoop: (chaseId: string, loop: boolean) => void;
  addChaseStep: (chaseId: string, sceneId: string) => void;
  removeChaseStep: (chaseId: string, stepId: string) => void;
  updateChaseStep: (chaseId: string, stepId: string, patch: Partial<Omit<ChaseStep, "id">>) => void;
  /** Mueve un step una posición hacia arriba (-1) o abajo (+1) en la secuencia. */
  moveChaseStep: (chaseId: string, stepId: string, direction: -1 | 1) => void;
  addEffect: (name: string) => Effect;
  /** Varios ya armados (los efectos listos). */
  addEffects: (drafts: Omit<Effect, "id" | "createdAt" | "updatedAt">[]) => Effect[];
  renameEffect: (effectId: string, name: string) => void;
  removeEffect: (effectId: string) => void;
  updateEffect: (effectId: string, patch: Partial<Omit<Effect, "id" | "createdAt">>) => void;
  startEffect: (effectId: string) => void;
  stopEffect: (effectId: string) => void;
  /** Uno a la vez: reproducir otro reemplaza al que esté sonando. */
  playChase: (chaseId: string) => void;
  stopChase: () => void;
  /** Apaga la luz de todo el rig sin mover las cabezas (ver dmxFrame.ts).
   *  Effects y Chases siguen corriendo por debajo, a oscuras. */
  blackout: () => void;
  releaseBlackout: () => void;
  setMaster: (value: number) => void;
  /** Velocidad de los effects y chases, en % (25–400). */
  setSpeed: (value: number) => void;
  setStrobe: (on: boolean) => void;
  /** Enciende un fixture a pleno unos segundos para reconocerlo. */
  identify: (instanceId: string) => void;
  addMoment: (name: string) => Moment;
  updateMoment: (momentId: string, patch: Partial<Omit<Moment, "id">>) => void;
  /** Guarda en la escena del momento cómo están las luces ahora, con el
   *  color fijo incluido. Sin escena, le crea una. */
  saveToMoment: (momentId: string) => void;
  /** Pone ese color en la escena del momento a las luces de esa fila ("" =
   *  sin grupo). Sin escena, le crea una. */
  paintMoment: (momentId: string, groupKey: string, hex: string) => void;
  removeMoment: (momentId: string) => void;
  moveMoment: (momentId: string, direction: -1 | 1) => void;
  /** Agrega los momentos de una quinceañera armados sobre el rig actual. */
  addQuinceTemplate: () => void;
  /** Vuelve los momentos, escenas y effects de la plantilla a como los arma. */
  resetQuinceTemplate: () => void;
  /** Pone los effects al día con los efectos listos (effectPresets.catalogUpdate),
   *  desde la versión del catálogo con la que ya estaba. */
  updateEffectCatalog: (from?: number) => void;
  /** Uno nuevo de ese tipo, sobre la primera máquina de efectos; sin ninguna,
   *  queda sin asignar (no toca ninguna luz). */
  addSpecial: (kind: SpecialKind) => Special;
  updateSpecial: (specialId: string, patch: Partial<Omit<Special, "id">>) => void;
  removeSpecial: (specialId: string) => void;
  addSongs: (songs: PlaylistSong[]) => void;
  updateSong: (songId: string, patch: Partial<Omit<PlaylistSong, "id">>) => void;
  removeSong: (songId: string) => void;
  moveSong: (songId: string, direction: -1 | 1) => void;
  addTimeline: (name: string) => Timeline;
  updateTimeline: (timelineId: string, patch: Partial<Omit<Timeline, "id">>) => void;
  removeTimeline: (timelineId: string) => void;
  /** Desde ese punto: las luces quedan como si hubiera sonado desde el
   *  principio. También para seguir tras una pausa. */
  playTimeline: (timelineId: string, fromMs: number) => void;
  pauseTimeline: () => void;
  stopTimeline: () => void;
  /** Un toque al ritmo de la canción (Tap). */
  tap: () => void;
  /** Vuelve a seguir lo que se escucha. */
  clearTap: () => void;
  /** Lanza un momento: corta los effects del anterior, el estrobo y el
   *  Blackout. */
  startMoment: (momentId: string) => void;
  /** Pasa al siguiente (1) o vuelve al anterior (-1). Sin ninguno lanzado,
   *  "siguiente" es el primero. */
  stepMoment: (direction: -1 | 1) => void;
  /** Corta el chase, los effects y el avance automático del momento; las
   *  luces quedan como están. */
  stopMoment: () => void;
  /** Deshacer y rehacer lo programado (ver lib/history.ts). No cambian liveValues. */
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** Guarda ya mismo (el guardado automático corre solo). Rechaza si el
   *  disco falla. */
  saveShow: () => Promise<void>;
  /** El show completo como JSON, para exportarlo. */
  serializeShow: () => string;
  /** Reemplaza el show por uno exportado. Lanza si el archivo no lo es. */
  importShow: (json: string) => void;
}

/** Las cabezas de ejemplo de la 0.2 venían con la rueda de color vacía: sin
 *  ella no toman un color fijo. Solo se llena si sigue vacía. */
function withWheel(definition: FixtureDefinition): FixtureDefinition {
  if (definition.id !== "def-orus-280") return definition;
  const channels = definition.channels.map((c) =>
    c.type === "COLOR_WHEEL" && c.presets.length === 0 ? { ...c, presets: ORUS_WHEEL, notes: ORUS_WHEEL_NOTE } : c,
  );
  return channels.some((c, i) => c !== definition.channels[i]) ? { ...definition, channels } : definition;
}

function restoreState(parsed: Partial<FixtureStoreState>): FixtureStoreState {
  // Migración suave: shows guardados antes de que existieran liveValues/
  // scenes/... no deben romper el load, solo completan con vacío.
  const selectedInstanceId = parsed.selectedInstanceId ?? seedInstances[0]?.id ?? null;
  return {
    definitions: (parsed.definitions ?? seedDefinitions).map(withWheel),
    instances: parsed.instances ?? seedInstances,
    selectedInstanceId,
    selectedInstanceIds: parsed.selectedInstanceIds ?? (selectedInstanceId ? [selectedInstanceId] : []),
    liveValues: parsed.liveValues ?? {},
    scenes: parsed.scenes ?? [],
    palettes: parsed.palettes ?? [],
    livePads: parsed.livePads ?? [],
    phonePads: parsed.phonePads ?? [],
    controls: parsed.controls ?? [],
    moving: {},
    activeSceneId: parsed.activeSceneId ?? null,
    groups: parsed.groups ?? [],
    chases: parsed.chases ?? [],
    effects: (parsed.effects ?? []).map((fx) => ({
      ...fx,
      // La plantilla de la 0.2 dejaba el golpe de graves en 40: sin música se
      // veía un brillo. Si nadie lo tocó, queda apagado como la de ahora.
      ...(fx.source === "bass" && fx.min === 40 && fx.max === 255 && fx.name.endsWith(": golpe de graves") ? { min: 0 } : {}),
      source: fx.source ?? "clock",
      beatsPerCycle: fx.beatsPerCycle ?? 1,
      kind: fx.kind ?? "wave",
      figure: fx.figure ?? "circle",
      sizeDeg: fx.sizeDeg ?? 20,
      angleDeg: fx.angleDeg ?? 0,
    })),
    moments: parsed.moments ?? [],
    timelines: parsed.timelines ?? [],
    playlist: parsed.playlist ?? [],
    specials: parsed.specials ?? [],
    activeMomentId: parsed.activeMomentId ?? null,
    ...IDLE,
  };
}

function serialize(state: FixtureStoreState): string {
  return JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => !NOT_SAVED.has(key))));
}

/** El show del disco, o el que el motor ya tenía en marcha. */
function initialState(engine: EngineLink): FixtureStoreState {
  const saved = loadInitialState();
  if (!engine.resumed) return saved;
  const { doc, live, playback } = engine.resumed;
  return { ...saved, ...docOf(doc), liveValues: live, ...playback };
}

function mergeValues(into: ChannelValues, values: ChannelValues): ChannelValues {
  const merged = { ...into };
  for (const [instanceId, channels] of Object.entries(values)) {
    merged[instanceId] = { ...merged[instanceId], ...channels };
  }
  return merged;
}

function loadInitialState(): FixtureStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return restoreState(JSON.parse(raw) as Partial<FixtureStoreState>);
  } catch {
    // localStorage no disponible o dato corrupto — se recurre a la semilla.
  }
  return restoreState({});
}

function resetMessage(s: FixtureStoreState): EngineMessage {
  const { liveValues: live, activeSceneId, activeMomentId } = s;
  return { type: "reset", doc: engineDoc(s), live, activeSceneId, activeMomentId };
}

const FixtureStoreContext = createContext<FixtureStoreValue | null>(null);

/**
 * Estado único de la app. Se persiste con showFile.ts: localStorage en el
 * navegador y, en la app de escritorio, además el archivo show.json.
 */
export function FixtureStoreProvider({ children }: { children: React.ReactNode }) {
  const [engine] = useState(createEngineLink);
  const [state, publish] = useState<FixtureStoreState>(() => initialState(engine));

  // Siempre al día, también entre dos cambios del mismo evento, cuando React
  // todavía no volvió a pintar.
  const stateRef = useRef(state);
  const setState = useCallback(
    (change: FixtureStoreState | ((s: FixtureStoreState) => FixtureStoreState)) => {
      const before = stateRef.current;
      const next = typeof change === "function" ? change(before) : change;
      if (next === before) return;
      stateRef.current = next;
      publish(next);
      if (!sameDoc(before, next)) engine.send({ type: "doc", doc: engineDoc(next) });
    },
    [engine],
  );

  useEffect(() => {
    const host: EngineHost = {
      onChanges: ({ full, values, moving, playback, now }: EngineChanges) => {
        noteEngineNow(now);
        const s = stateRef.current;
        const liveValues = full ? values : mergeValues(s.liveValues, values);
        stateRef.current = { ...s, ...playback, liveValues, moving: moving ?? s.moving };
        publish(stateRef.current);
      },
      resetMessage: () => resetMessage(stateRef.current),
      docMessage: () => ({ type: "doc", doc: engineDoc(stateRef.current) }),
      onCloseAsked: () =>
        askChoice({
          title: "Las luces están encendidas",
          text: "¿Qué hago con ellas al cerrar la ventana? Si las dejas, siguen con el show y con el celular; para volver, abre LUMEN PRO otra vez.",
          options: [
            { label: "Dejar las luces y cerrar", onSelect: () => closeWindow(true) },
            { label: "Apagar todo y salir", variant: "danger", onSelect: () => closeWindow(false) },
          ],
        }),
    };
    return engine.start(host);
  }, [engine]);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveShow = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    return writeShow(serialize(stateRef.current));
  }, []);

  useEffect(() => {
    if (persistTimer.current) return;
    persistTimer.current = setTimeout(() => {
      saveShow().catch((e) => console.error("No se pudo guardar el show", e));
    }, PERSIST_EVERY_MS);
  }, [saveShow, state]);

  // Lo que haya quedado esperando el timer se guarda al cerrar.
  useEffect(() => {
    const flush = () => {
      if (persistTimer.current) saveShow().catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [saveShow]);

  const [history, setHistory] = useState(EMPTY_HISTORY);
  const historyRef = useRef(history);
  const lastDoc = useRef(docOf(state));

  useEffect(() => {
    const before = lastDoc.current;
    if (sameDoc(before, state)) return;
    lastDoc.current = docOf(state);
    historyRef.current = recordChange(historyRef.current, before, lastDoc.current, Date.now());
    setHistory(historyRef.current);
  }, [state]);

  const timeTravel = useCallback((direction: -1 | 1) => {
    const step = travel(historyRef.current, lastDoc.current, direction);
    if (!step) return;
    historyRef.current = step.history;
    setHistory(step.history);
    lastDoc.current = step.doc; // para que el efecto de arriba no lo tome por un cambio nuevo
    setState((s) => ({ ...s, ...step.doc }));
  }, [setState]);
  const undo = useCallback(() => timeTravel(-1), [timeTravel]);
  const redo = useCallback(() => timeTravel(1), [timeTravel]);

  const serializeShow = useCallback(() => serialize(stateRef.current), []);

  const importShow = useCallback((json: string) => {
    let parsed: Partial<FixtureStoreState> | null = null;
    try {
      parsed = JSON.parse(json) as Partial<FixtureStoreState>;
    } catch {
      // Cae en el mismo mensaje que un JSON válido que no es un show.
    }
    if (!Array.isArray(parsed?.definitions) || !Array.isArray(parsed.instances)) {
      throw new Error("El archivo no es un show de LUMEN PRO");
    }
    setState(restoreState(parsed));
    engine.send(resetMessage(stateRef.current));
  }, [engine, setState]);

  const selectInstances = useCallback((instanceIds: string[]) => {
    setState((s) => ({ ...s, selectedInstanceId: instanceIds[0] ?? null, selectedInstanceIds: instanceIds }));
  }, [setState]);
  const selectInstance = useCallback(
    (instanceId: string | null) => selectInstances(instanceId ? [instanceId] : []),
    [selectInstances],
  );

  const addDefinition = useCallback((def: FixtureDefinition) => {
    setState((s) => ({ ...s, definitions: [...s.definitions, def] }));
  }, [setState]);

  const updateDefinition = useCallback((def: FixtureDefinition) => {
    setState((s) => ({
      ...s,
      definitions: s.definitions.map((d) => (d.id === def.id ? def : d)),
    }));
  }, [setState]);

  const removeDefinition = useCallback((defId: string) => {
    setState((s) => ({
      ...s,
      definitions: s.definitions.filter((d) => d.id !== defId),
      instances: s.instances.filter((i) => i.definitionId !== defId),
    }));
  }, [setState]);

  const addInstance = useCallback((instance: FixtureInstance) => {
    setState((s) => ({ ...s, instances: [...s.instances, instance] }));
  }, [setState]);

  const updateInstance = useCallback((instance: FixtureInstance) => {
    setState((s) => ({
      ...s,
      instances: s.instances.map((i) => (i.id === instance.id ? instance : i)),
    }));
  }, [setState]);

  const removeInstance = useCallback((instanceId: string) => {
    setState((s) => ({
      ...s,
      instances: s.instances.filter((i) => i.id !== instanceId),
      selectedInstanceId: s.selectedInstanceId === instanceId ? null : s.selectedInstanceId,
      selectedInstanceIds: s.selectedInstanceIds.filter((id) => id !== instanceId),
    }));
  }, [setState]);

  const getChannelValue = useCallback(
    (instanceId: string, channelId: string, fallback: number) =>
      state.liveValues[instanceId]?.[channelId] ?? fallback,
    [state.liveValues],
  );

  // Se ven al instante, sin esperar a que el motor conteste. Las luces que
  // van juntas (misma dirección) reciben lo mismo.
  const setChannelValues = useCallback(
    (changed: ChannelValues) => {
      const values = withTwins(stateRef.current.instances, changed);
      setState((s) => ({ ...s, liveValues: mergeValues(s.liveValues, values) }));
      engine.send({ type: "values", values });
    },
    [engine, setState],
  );
  const setChannelValue = useCallback(
    (instanceId: string, channelId: string, value: number) => setChannelValues({ [instanceId]: { [channelId]: value } }),
    [setChannelValues],
  );

  /** Captura TODOS los canales con valor conocido de TODOS los fixtures que
   *  tengan al menos un canal tocado en liveValues (fixtures nunca tocados
   *  se omiten: guardar sus defaults no aporta nada y solo infla la escena). */
  const captureSnapshot = useCallback(
    (s: FixtureStoreState): Record<string, Record<string, number>> =>
      Object.fromEntries(
        Object.entries(s.liveValues)
          .filter(([, channels]) => Object.keys(channels).length > 0)
          .map(([instanceId, channels]) => [instanceId, { ...channels }]),
      ),
    [],
  );

  const saveScene = useCallback(
    (name: string): Scene => {
      const scene: Scene = {
        id: makeId("scene"),
        name: name.trim() || "Sin nombre",
        values: captureSnapshot(stateRef.current),
        refs: matchPalettes(stateRef.current, stateRef.current.palettes),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => ({ ...s, scenes: [...s.scenes, scene], activeSceneId: scene.id }));
      engine.send({ type: "activeScene", id: scene.id });
      return scene;
    },
    [captureSnapshot, engine, setState],
  );

  /** Re-graba una escena existente con el estado actual del rig — "actualizar
   *  escena" en vez de crear una nueva, útil cuando ajustas una escena ya guardada. */
  const updateSceneValues = useCallback(
    (sceneId: string) => {
      setState((s) => ({
        ...s,
        scenes: s.scenes.map((sc) =>
          sc.id === sceneId
            ? { ...sc, values: captureSnapshot(s), refs: matchPalettes(s, s.palettes), updatedAt: Date.now() }
            : sc,
        ),
      }));
    },
    [captureSnapshot],
  );

  const renameScene = useCallback((sceneId: string, name: string) => {
    setState((s) => ({
      ...s,
      scenes: s.scenes.map((sc) =>
        sc.id === sceneId ? { ...sc, name: name.trim() || sc.name, updatedAt: Date.now() } : sc,
      ),
    }));
  }, [setState]);

  const removeScene = useCallback((sceneId: string) => {
    setState((s) => ({
      ...s,
      scenes: s.scenes.filter((sc) => sc.id !== sceneId),
      moments: s.moments.map((m) => (m.sceneId === sceneId ? { ...m, sceneId: null } : m)),
    }));
  }, [setState]);

  /** Recall = merge, no blackout (ver comentario en types/scene.ts): solo
   *  pisa los instanceId/channelId que la escena capturó. */
  const addPalette = useCallback(
    (kind: PaletteKind, name: string, chosen: FixtureInstance[]): Palette => {
      const palette: Palette = { id: makeId("palette"), name, kind, values: capture(stateRef.current, kind, chosen) };
      setState((s) => ({ ...s, palettes: [...s.palettes, palette] }));
      return palette;
    },
    [setState],
  );

  const addColorPalette = useCallback(
    (name: string, hex: string): Palette => {
      const palette: Palette = {
        id: makeId("palette"),
        name,
        kind: "color",
        hex,
        values: colorPaletteValues(stateRef.current, hex),
      };
      setState((s) => ({ ...s, palettes: [...s.palettes, palette] }));
      return palette;
    },
    [setState],
  );

  const updatePalette = useCallback(
    (paletteId: string) =>
      setState((s) => ({
        ...s,
        palettes: s.palettes.map((p) => {
          if (p.id !== paletteId) return p;
          const owners = s.instances.filter((i) => p.values[i.id]);
          // Corregida a mano: ya no es "el color tal" para las que se agreguen.
          return { ...p, hex: undefined, values: capture(s, p.kind, owners.length > 0 ? owners : s.instances) };
        }),
      })),
    [setState],
  );

  const renamePalette = useCallback(
    (paletteId: string, name: string) =>
      setState((s) => ({ ...s, palettes: s.palettes.map((p) => (p.id === paletteId ? { ...p, name } : p)) })),
    [setState],
  );

  const removePalette = useCallback(
    (paletteId: string) =>
      setState((s) => {
        const palette = s.palettes.find((p) => p.id === paletteId);
        const scenes = s.scenes.map((scene) => {
          if (!palette || !Object.values(scene.refs ?? {}).some((r) => r[palette.kind] === paletteId)) return scene;
          const values = { ...scene.values };
          const refs = { ...scene.refs };
          for (const [instanceId, own] of Object.entries(refs)) {
            if (own[palette.kind] !== paletteId) continue;
            values[instanceId] = { ...values[instanceId], ...palette.values[instanceId] };
            const { [palette.kind]: _gone, ...rest } = own;
            refs[instanceId] = rest;
          }
          return { ...scene, values, refs };
        });
        return { ...s, scenes, palettes: s.palettes.filter((p) => p.id !== paletteId) };
      }),
    [setState],
  );

  const applyPalette = useCallback(
    (paletteId: string, chosen: FixtureInstance[]) => {
      const palette = stateRef.current.palettes.find((p) => p.id === paletteId);
      if (palette) setChannelValues(paletteValues(palette, stateRef.current, chosen));
    },
    [setChannelValues],
  );

  const setLivePads = useCallback((livePads: Pad[]) => setState((s) => ({ ...s, livePads })), [setState]);
  const setPhonePads = useCallback((phonePads: Pad[]) => setState((s) => ({ ...s, phonePads })), [setState]);
  const setControls = useCallback((controls: Control[]) => setState((s) => ({ ...s, controls })), [setState]);
  const act = useCallback(
    (action: Action, press?: boolean, value?: number) => engine.send({ type: "action", action, press, value }),
    [engine],
  );

  const holdColor = useCallback(
    (groupId: string | null, color: string | null) => act({ do: "color", groupId, color }, true),
    [act],
  );
  const { instances, definitions, groups, heldColors, effects, runningEffectIds } = state;
  const held = useMemo(
    () => heldValues({ instances, definitions, groups }, heldColors, tintedGroups(effects, runningEffectIds)),
    [instances, definitions, groups, heldColors, effects, runningEffectIds],
  );

  const recallScene = useCallback((sceneId: string) => engine.send({ type: "recallScene", id: sceneId }), [engine]);

  const addGroup = useCallback(
    (name: string): Group => {
      const created: Group = {
        id: makeId("group"),
        name: name.trim() || `Grupo ${state.groups.length + 1}`,
        color: GROUP_COLORS[state.groups.length % GROUP_COLORS.length],
      };
      setState((s) => ({ ...s, groups: [...s.groups, created] }));
      return created;
    },
    [state.groups.length],
  );

  const renameGroup = useCallback((groupId: string, name: string) => {
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g)),
    }));
  }, [setState]);

  const removeGroup = useCallback((groupId: string) => {
    setState((s) => ({
      ...s,
      groups: s.groups.filter((g) => g.id !== groupId),
      // Desagrupa a los fixtures que estaban en el grupo borrado, en vez
      // de dejarlos apuntando a un group.id que ya no existe.
      instances: s.instances.map((i) => (i.group === groupId ? { ...i, group: undefined } : i)),
    }));
  }, [setState]);

  const setInstanceGroup = useCallback((instanceId: string, groupId: string | null) => {
    setState((s) => ({
      ...s,
      instances: s.instances.map((i) => (i.id === instanceId ? { ...i, group: groupId ?? undefined } : i)),
    }));
  }, [setState]);

  /** Aplica un valor a todo canal de tipo `channelType` en todo fixture del
   *  grupo — cada fixture puede tener ese tipo de canal en un índice DMX
   *  distinto (LPC007 vs Orus), por eso se resuelve por tipo, no por id de
   *  canal fijo. Si un fixture del grupo no tiene ese tipo de canal, se
   *  omite silenciosamente (p. ej. subir "Gobo" en un grupo mixto que
   *  incluye PARs sin gobo). */
  const setGroupChannelByType = useCallback(
    (groupId: string, channelType: string, value: number) => {
      const { instances, definitions } = stateRef.current;
      const values: ChannelValues = {};
      for (const instance of instances) {
        if (instance.group !== groupId) continue;
        const channels = definitions.find((d) => d.id === instance.definitionId)?.channels ?? [];
        values[instance.id] = Object.fromEntries(
          channels.filter((c) => c.type === channelType).map((c) => [c.id, value]),
        );
      }
      setChannelValues(values);
    },
    [setChannelValues],
  );

  const addChase = useCallback(
    (name: string): Chase => {
      const created: Chase = {
        id: makeId("chase"),
        name: name.trim() || `Chase ${state.chases.length + 1}`,
        steps: [],
        loop: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => ({ ...s, chases: [...s.chases, created] }));
      return created;
    },
    [state.chases.length],
  );

  const renameChase = useCallback((chaseId: string, name: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) =>
        c.id === chaseId ? { ...c, name: name.trim() || c.name, updatedAt: Date.now() } : c,
      ),
    }));
  }, [setState]);

  const removeChase = useCallback((chaseId: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.filter((c) => c.id !== chaseId),
      moments: s.moments.map((m) => (m.chaseId === chaseId ? { ...m, chaseId: null } : m)),
    }));
  }, [setState]);

  const setChaseLoop = useCallback((chaseId: string, loop: boolean) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) => (c.id === chaseId ? { ...c, loop, updatedAt: Date.now() } : c)),
    }));
  }, [setState]);

  /** Agrega un step al final referenciando una Scene existente, con
   *  tiempos por defecto razonables (1s de fade, 3s de hold) que el
   *  usuario puede ajustar después con updateChaseStep. */
  const addChaseStep = useCallback((chaseId: string, sceneId: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) =>
        c.id === chaseId
          ? {
              ...c,
              steps: [...c.steps, { id: makeId("step"), sceneId, fadeMs: 1000, holdMs: 3000 }],
              updatedAt: Date.now(),
            }
          : c,
      ),
    }));
  }, [setState]);

  const removeChaseStep = useCallback((chaseId: string, stepId: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) =>
        c.id === chaseId
          ? { ...c, steps: c.steps.filter((st) => st.id !== stepId), updatedAt: Date.now() }
          : c,
      ),
    }));
  }, [setState]);

  const updateChaseStep = useCallback(
    (chaseId: string, stepId: string, patch: Partial<Omit<ChaseStep, "id">>) => {
      setState((s) => ({
        ...s,
        chases: s.chases.map((c) =>
          c.id === chaseId
            ? {
                ...c,
                steps: c.steps.map((st) => (st.id === stepId ? { ...st, ...patch } : st)),
                updatedAt: Date.now(),
              }
            : c,
        ),
      }));
    },
    [],
  );

  const moveChaseStep = useCallback((chaseId: string, stepId: string, direction: -1 | 1) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) => {
        if (c.id !== chaseId) return c;
        const index = c.steps.findIndex((st) => st.id === stepId);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= c.steps.length) return c;
        const steps = [...c.steps];
        [steps[index], steps[target]] = [steps[target], steps[index]];
        return { ...c, steps, updatedAt: Date.now() };
      }),
    }));
  }, [setState]);

  const addEffects = useCallback(
    (drafts: Omit<Effect, "id" | "createdAt" | "updatedAt">[]): Effect[] => {
      const now = Date.now();
      const created = drafts.map((d) => ({ ...d, id: makeId("effect"), createdAt: now, updatedAt: now }));
      setState((s) => ({ ...s, effects: [...s.effects, ...created] }));
      return created;
    },
    [setState],
  );

  const addEffect = useCallback(
    (name: string): Effect => {
      // Mismo cuidado que en addChase/addGroup: el objeto se construye
      // ANTES de llamar a setState (ver comentario ahí — no depender de
      // que el updater corra de forma síncrona).
      const created: Effect = {
        id: makeId("effect"),
        name: name.trim() || `Effect ${state.effects.length + 1}`,
        groupId: null,
        kind: "wave",
        figure: "circle",
        sizeDeg: 20,
        angleDeg: 0,
        channelType: "DIMMER",
        waveform: "sine",
        speedCpm: 20,
        min: 0,
        max: 255,
        phaseOffsetDeg: 0,
        source: "clock",
        beatsPerCycle: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => ({ ...s, effects: [...s.effects, created] }));
      return created;
    },
    [state.effects.length],
  );

  const renameEffect = useCallback((effectId: string, name: string) => {
    setState((s) => ({
      ...s,
      effects: s.effects.map((e) =>
        e.id === effectId ? { ...e, name: name.trim() || e.name, updatedAt: Date.now() } : e,
      ),
    }));
  }, [setState]);

  const removeEffect = useCallback((effectId: string) => {
    setState((s) => ({
      ...s,
      effects: s.effects.filter((e) => e.id !== effectId),
      moments: s.moments.map((m) => ({ ...m, effectIds: m.effectIds.filter((id) => id !== effectId) })),
    }));
  }, [setState]);

  const updateEffect = useCallback((effectId: string, patch: Partial<Omit<Effect, "id" | "createdAt">>) => {
    setState((s) => ({
      ...s,
      effects: s.effects.map((e) => (e.id === effectId ? { ...e, ...patch, updatedAt: Date.now() } : e)),
    }));
  }, [setState]);

  const startEffect = useCallback((id: string) => engine.send({ type: "startEffect", id }), [engine]);
  const stopEffect = useCallback((id: string) => engine.send({ type: "stopEffect", id }), [engine]);
  const playChase = useCallback((id: string) => engine.send({ type: "playChase", id }), [engine]);
  const stopChase = useCallback(() => engine.send({ type: "stopChase" }), [engine]);
  const blackout = useCallback(() => engine.send({ type: "blackout", on: true }), [engine]);
  const releaseBlackout = useCallback(() => engine.send({ type: "blackout", on: false }), [engine]);
  const setMaster = useCallback((value: number) => engine.send({ type: "master", value }), [engine]);
  const setSpeed = useCallback((value: number) => engine.send({ type: "speed", value }), [engine]);
  const setStrobe = useCallback((on: boolean) => engine.send({ type: "strobe", on }), [engine]);
  const identify = useCallback((id: string) => engine.send({ type: "identify", id }), [engine]);

  const addMoment = useCallback(
    (name: string): Moment => {
      const created: Moment = {
        id: makeId("moment"),
        name: name.trim() || `Momento ${state.moments.length + 1}`,
        sceneId: null,
        chaseId: null,
        effectIds: [],
        fadeMs: 2000,
        durationSec: null,
      };
      setState((s) => ({ ...s, moments: [...s.moments, created] }));
      return created;
    },
    [state.moments.length],
  );

  const updateMoment = useCallback((momentId: string, patch: Partial<Omit<Moment, "id">>) => {
    setState((s) => ({
      ...s,
      moments: s.moments.map((m) => (m.id === momentId ? { ...m, ...patch } : m)),
    }));
  }, [setState]);

  const removeMoment = useCallback((momentId: string) => {
    setState((s) => ({
      ...s,
      moments: s.moments.filter((m) => m.id !== momentId),
    }));
  }, [setState]);

  const addSpecial = useCallback(
    (kind: SpecialKind): Special => {
      const s = stateRef.current;
      const definitionOf = (definitionId: string) => s.definitions.find((d) => d.id === definitionId);
      // Nunca una luz por las dudas: su canal quedaría en 0.
      const machine = s.instances.find((i) => ["Smoke", "Hazer", "Effect"].includes(definitionOf(i.definitionId)?.kind ?? ""));
      const channel = machine && definitionOf(machine.definitionId)?.channels[0];
      const created: Special = {
        id: makeId("special"),
        name: SPECIAL_KINDS[kind].name,
        kind,
        instanceId: machine && channel ? machine.id : "",
        channelId: channel?.id ?? "",
        ...SPECIAL_KINDS[kind].defaults,
      };
      setState((st) => ({ ...st, specials: [...st.specials, created] }));
      return created;
    },
    [setState],
  );
  const updateSpecial = useCallback((specialId: string, patch: Partial<Omit<Special, "id">>) => {
    setState((s) => ({ ...s, specials: s.specials.map((x) => (x.id === specialId ? { ...x, ...patch } : x)) }));
  }, [setState]);
  const removeSpecial = useCallback((specialId: string) => {
    setState((s) => ({ ...s, specials: s.specials.filter((x) => x.id !== specialId) }));
  }, [setState]);

  const addSongs = useCallback((songs: PlaylistSong[]) => {
    setState((s) => ({ ...s, playlist: [...s.playlist, ...songs] }));
  }, [setState]);
  const updateSong = useCallback((songId: string, patch: Partial<Omit<PlaylistSong, "id">>) => {
    setState((s) => ({ ...s, playlist: s.playlist.map((p) => (p.id === songId ? { ...p, ...patch } : p)) }));
  }, [setState]);
  const removeSong = useCallback((songId: string) => {
    setState((s) => ({ ...s, playlist: s.playlist.filter((p) => p.id !== songId) }));
  }, [setState]);
  const moveSong = useCallback((songId: string, direction: -1 | 1) => {
    setState((s) => {
      const index = s.playlist.findIndex((p) => p.id === songId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= s.playlist.length) return s;
      const playlist = [...s.playlist];
      [playlist[index], playlist[target]] = [playlist[target], playlist[index]];
      return { ...s, playlist };
    });
  }, [setState]);

  const addTimeline = useCallback(
    (name: string): Timeline => {
      const created: Timeline = { id: makeId("timeline"), name: name.trim() || "Vals", song: null, durationMs: 0, cues: [] };
      setState((s) => ({ ...s, timelines: [...s.timelines, created] }));
      return created;
    },
    [setState],
  );
  const updateTimeline = useCallback((timelineId: string, patch: Partial<Omit<Timeline, "id">>) => {
    setState((s) => ({ ...s, timelines: s.timelines.map((t) => (t.id === timelineId ? { ...t, ...patch } : t)) }));
  }, [setState]);
  const removeTimeline = useCallback((timelineId: string) => {
    setState((s) => ({ ...s, timelines: s.timelines.filter((t) => t.id !== timelineId) }));
  }, [setState]);
  const playTimeline = useCallback(
    (id: string, fromMs: number) => engine.send({ type: "playTimeline", id, fromMs: Math.max(0, Math.round(fromMs)) }),
    [engine],
  );
  const pauseTimeline = useCallback(() => engine.send({ type: "pauseTimeline" }), [engine]);
  const stopTimeline = useCallback(() => engine.send({ type: "stopTimeline" }), [engine]);
  // Con la hora en que se tocó: el envío puede demorar un poco.
  const tap = useCallback(() => engine.send({ type: "tap", at: Math.round(engineNow()) }), [engine]);
  const clearTap = useCallback(() => engine.send({ type: "clearTap" }), [engine]);

  const moveMoment = useCallback((momentId: string, direction: -1 | 1) => {
    setState((s) => {
      const index = s.moments.findIndex((m) => m.id === momentId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= s.moments.length) return s;
      const moments = [...s.moments];
      [moments[index], moments[target]] = [moments[target], moments[index]];
      return { ...s, moments };
    });
  }, [setState]);

  const saveToMoment = useCallback(
    (momentId: string) =>
      setState((s) => {
        const moment = s.moments.find((m) => m.id === momentId);
        if (!moment) return s;
        const now = Date.now();
        const values = mergeValues(captureSnapshot(s), heldValues(s, s.heldColors));
        let scenes = s.scenes;
        let sceneId = moment.sceneId;
        if (!sceneId || !scenes.some((sc) => sc.id === sceneId)) {
          sceneId = makeId("scene");
          scenes = [...scenes, { id: sceneId, name: moment.name, values: {}, createdAt: now, updatedAt: now }];
        }
        const refs = matchPalettes({ ...s, liveValues: values }, s.palettes);
        scenes = scenes.map((sc) => (sc.id === sceneId ? { ...sc, values, refs, updatedAt: now } : sc));
        return { ...s, scenes, moments: s.moments.map((m) => (m.id === momentId ? { ...m, sceneId } : m)) };
      }),
    [captureSnapshot, setState],
  );

  const resetQuinceTemplate = useCallback(
    () => setState((s) => ({ ...s, ...resetTemplate(s, makeId) })),
    [setState],
  );

  const updateEffectCatalog = useCallback((from = 0) => {
    // Fuera del updater: makeId no debe correr dos veces.
    const patch = catalogUpdate(stateRef.current, makeId, from);
    if (patch) setState((s) => ({ ...s, ...patch }));
  }, [setState]);

  const paintMoment = useCallback(
    (momentId: string, groupKey: string, hex: string) =>
      setState((s) => {
        const moment = s.moments.find((m) => m.id === momentId);
        if (!moment) return s;
        const now = Date.now();
        let scenes = s.scenes;
        let sceneId = moment.sceneId;
        if (!sceneId || !scenes.some((sc) => sc.id === sceneId)) {
          sceneId = makeId("scene");
          scenes = [...scenes, { id: sceneId, name: moment.name, values: {}, createdAt: now, updatedAt: now }];
        }
        const members = colorMembers(s, groupKey);
        scenes = scenes.map((scene) => {
          if (scene.id !== sceneId) return scene;
          const values = { ...scene.values };
          const refs = { ...scene.refs };
          for (const instance of members) {
            const definition = s.definitions.find((d) => d.id === instance.definitionId)!;
            // Apagada no se vería el color.
            const dimmer = definition.channels.find((c) => c.type === "DIMMER");
            const lit = dimmer && values[instance.id]?.[dimmer.id] === undefined ? { [dimmer.id]: 255 } : {};
            values[instance.id] = { ...values[instance.id], ...lit, ...colorValues(definition, hex) };
            // Una paleta de color guardada mandaría sobre esto.
            if (refs[instance.id]?.color) {
              const { color: _gone, ...rest } = refs[instance.id];
              refs[instance.id] = rest;
            }
          }
          return { ...scene, values, refs, updatedAt: now };
        });
        const moments = s.moments.map((m) => (m.id === momentId ? { ...m, sceneId } : m));
        return { ...s, scenes, moments };
      }),
    [setState],
  );

  const addQuinceTemplate = useCallback(() => {
    const before = stateRef.current;
    const t = buildQuinceTemplate(before, makeId);
    // Con todos los efectos listos de sus grupos, en el mismo paso: un
    // Deshacer quita todo junto.
    const now = Date.now();
    const presets = missingPresets({ ...before, instances: t.instances, groups: t.groups, effects: [...before.effects, ...t.effects] })
      .map((d) => ({ ...d, id: makeId("effect"), createdAt: now, updatedAt: now }));
    setState((s) => ({
      ...s,
      instances: t.instances,
      groups: t.groups,
      scenes: [...s.scenes, ...t.scenes],
      effects: [...s.effects, ...t.effects, ...presets],
      moments: [...s.moments, ...t.moments],
    }));
  }, [setState]);

  const startMoment = useCallback((id: string) => engine.send({ type: "startMoment", id }), [engine]);
  const stepMoment = useCallback((direction: -1 | 1) => engine.send({ type: "stepMoment", direction }), [engine]);
  const stopMoment = useCallback(() => engine.send({ type: "stopMoment" }), [engine]);

  const selectedInstances = useMemo(
    () => state.instances.filter((i) => state.selectedInstanceIds.includes(i.id)),
    [state.instances, state.selectedInstanceIds],
  );
  const selectedInstance = useMemo(
    () => state.instances.find((i) => i.id === state.selectedInstanceId) ?? selectedInstances[0] ?? null,
    [state.instances, state.selectedInstanceId, selectedInstances],
  );
  const selectedDefinition = useMemo(
    () => state.definitions.find((d) => d.id === selectedInstance?.definitionId) ?? null,
    [state.definitions, selectedInstance],
  );

  const value: FixtureStoreValue = {
    ...state,
    engine,
    selectedInstance,
    selectedDefinition,
    selectedInstances,
    selectInstance,
    selectInstances,
    addDefinition,
    updateDefinition,
    removeDefinition,
    addInstance,
    updateInstance,
    removeInstance,
    getChannelValue,
    setChannelValue,
    setChannelValues,
    saveScene,
    addPalette,
    addColorPalette,
    updatePalette,
    renamePalette,
    removePalette,
    applyPalette,
    setLivePads,
    setPhonePads,
    setControls,
    act,
    held,
    holdColor,
    updateSceneValues,
    renameScene,
    removeScene,
    recallScene,
    addGroup,
    renameGroup,
    removeGroup,
    setInstanceGroup,
    setGroupChannelByType,
    addChase,
    renameChase,
    removeChase,
    setChaseLoop,
    addChaseStep,
    removeChaseStep,
    updateChaseStep,
    moveChaseStep,
    addEffect,
    addEffects,
    renameEffect,
    removeEffect,
    updateEffect,
    startEffect,
    stopEffect,
    playChase,
    stopChase,
    blackout,
    releaseBlackout,
    setMaster,
    setSpeed,
    setStrobe,
    identify,
    addMoment,
    updateMoment,
    removeMoment,
    addSpecial,
    updateSpecial,
    removeSpecial,
    addSongs,
    updateSong,
    removeSong,
    moveSong,
    addTimeline,
    updateTimeline,
    removeTimeline,
    playTimeline,
    pauseTimeline,
    stopTimeline,
    tap,
    clearTap,
    moveMoment,
    addQuinceTemplate,
    resetQuinceTemplate,
    updateEffectCatalog,
    saveToMoment,
    paintMoment,
    startMoment,
    stepMoment,
    stopMoment,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    saveShow,
    serializeShow,
    importShow,
  };

  return <FixtureStoreContext.Provider value={value}>{children}</FixtureStoreContext.Provider>;
}

export function useFixtureStore() {
  const ctx = useContext(FixtureStoreContext);
  if (!ctx) throw new Error("useFixtureStore debe usarse dentro de FixtureStoreProvider");
  return ctx;
}
