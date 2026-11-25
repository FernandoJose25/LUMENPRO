import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Scene } from "@/types/scene";
import type { Group } from "@/types/group";
import { GROUP_COLORS } from "@/types/group";
import type { Chase, ChaseStep } from "@/types/chase";
import type { Effect } from "@/types/effect";
import type { Moment } from "@/types/moment";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import { buildQuinceTemplate } from "@/data/quinceTemplate";
import type { ChannelValues } from "@/lib/fade";
import { docOf, EMPTY_HISTORY, recordChange, sameDoc, travel } from "@/lib/history";
import { STORAGE_KEY, writeShow } from "@/lib/showFile";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Con un Effect corriendo el estado cambia 25 veces por segundo: se guarda
// como mucho una vez por segundo en vez de escribir a disco en cada tick.
const PERSIST_EVERY_MS = 1000;

const IDENTIFY_MS = 3000;

interface FixtureStoreState {
  definitions: FixtureDefinition[];
  instances: FixtureInstance[];
  selectedInstanceId: string | null;
  /** Valores de canal "en vivo" (lo que hoy estaría saliendo por DMX si
   *  hubiera un motor conectado — ver AUDIT.md). instanceId -> channelId -> valor.
   *  Antes de esto vivía como useState local dentro de FixtureControl y se
   *  perdía al cambiar de fixture seleccionado; ahora es la fuente de verdad
   *  única, para que Scenes pueda capturarlo y recuperarlo. */
  liveValues: Record<string, Record<string, number>>;
  scenes: Scene[];
  /** Última escena recuperada con éxito — solo para resaltar el botón activo
   *  en la UI; no es una garantía de que nada se haya movido desde entonces. */
  activeSceneId: string | null;
  groups: Group[];
  chases: Chase[];
  effects: Effect[];
  /** Ids de Effect corriendo AHORA. Deliberadamente NO se persiste entre
   *  recargas de página (ver loadInitialState y el useEffect de guardado)
   *  — al recargar, ningún efecto debería arrancar solo. */
  runningEffectIds: string[];
  /** Blackout puesto. No toca liveValues: apaga en la salida (dmxFrame.ts),
   *  así nada puede pisarlo y al quitarlo todo vuelve como estaba. Tampoco
   *  se persiste. */
  blackoutActive: boolean;
  /** Intensidad general 0–100 y estrobo general: se aplican en la salida
   *  (dmxFrame.ts) sobre lo que esté sonando. No se persisten. */
  master: number;
  strobeActive: boolean;
  /** Fixture que se está identificando (ver identify), o null. */
  identifyId: string | null;
  /** En el orden del evento. */
  moments: Moment[];
  /** Último momento lanzado. Se persiste: si la app se cierra a mitad del
   *  evento, "Siguiente" retoma desde ahí. */
  activeMomentId: string | null;
  /** Arranque en curso de activeMomentId (ver lib/momentsEngine.ts), o null
   *  si está detenido. No se persiste: al abrir, nada arranca solo. */
  momentRun: { nonce: number; startedAt: number } | null;
}

interface FixtureStoreValue extends FixtureStoreState {
  selectedInstance: FixtureInstance | null;
  selectedDefinition: FixtureDefinition | null;
  selectInstance: (instanceId: string | null) => void;
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
  renameEffect: (effectId: string, name: string) => void;
  removeEffect: (effectId: string) => void;
  updateEffect: (effectId: string, patch: Partial<Omit<Effect, "id" | "createdAt">>) => void;
  startEffect: (effectId: string) => void;
  stopEffect: (effectId: string) => void;
  /** Apaga la luz de todo el rig sin mover las cabezas (ver dmxFrame.ts).
   *  Effects y Chases siguen corriendo por debajo, a oscuras. */
  blackout: () => void;
  releaseBlackout: () => void;
  setMaster: (value: number) => void;
  setStrobe: (on: boolean) => void;
  /** Enciende un fixture a pleno unos segundos para reconocerlo. */
  identify: (instanceId: string) => void;
  addMoment: (name: string) => Moment;
  updateMoment: (momentId: string, patch: Partial<Omit<Moment, "id">>) => void;
  removeMoment: (momentId: string) => void;
  moveMoment: (momentId: string, direction: -1 | 1) => void;
  /** Agrega los momentos de una quinceañera armados sobre el rig actual. */
  addQuinceTemplate: () => void;
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

function restoreState(parsed: Partial<FixtureStoreState>): FixtureStoreState {
  // Migración suave: shows guardados antes de que existieran liveValues/
  // scenes/... no deben romper el load, solo completan con vacío.
  return {
    definitions: parsed.definitions ?? seedDefinitions,
    instances: parsed.instances ?? seedInstances,
    selectedInstanceId: parsed.selectedInstanceId ?? seedInstances[0]?.id ?? null,
    liveValues: parsed.liveValues ?? {},
    scenes: parsed.scenes ?? [],
    activeSceneId: parsed.activeSceneId ?? null,
    groups: parsed.groups ?? [],
    chases: parsed.chases ?? [],
    effects: (parsed.effects ?? []).map((fx) => ({ ...fx, source: fx.source ?? "clock", beatsPerCycle: fx.beatsPerCycle ?? 1 })),
    runningEffectIds: [], // nunca se restaura, ver comentario en el tipo
    blackoutActive: false, // ídem
    master: 100, // ídem
    strobeActive: false, // ídem
    identifyId: null, // ídem
    moments: parsed.moments ?? [],
    activeMomentId: parsed.activeMomentId ?? null,
    momentRun: null, // ídem
  };
}

function serialize(state: FixtureStoreState): string {
  const {
    runningEffectIds: _runningEffectIds,
    blackoutActive: _blackoutActive,
    master: _master,
    strobeActive: _strobeActive,
    identifyId: _identifyId,
    momentRun: _momentRun,
    ...persisted
  } = state;
  return JSON.stringify(persisted);
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

const FixtureStoreContext = createContext<FixtureStoreValue | null>(null);

/**
 * Estado único de la app. Se persiste con showFile.ts: localStorage en el
 * navegador y, en la app de escritorio, además el archivo show.json.
 */
export function FixtureStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FixtureStoreState>(loadInitialState);

  const stateRef = useRef(state);
  stateRef.current = state;
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
    setState((s) => {
      const momentExists = step.doc.moments.some((m) => m.id === s.activeMomentId);
      return {
        ...s,
        ...step.doc,
        runningEffectIds: s.runningEffectIds.filter((id) => step.doc.effects.some((e) => e.id === id)),
        ...(momentExists ? {} : { activeMomentId: null, momentRun: null }),
      };
    });
  }, []);
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
  }, []);

  const selectInstance = useCallback((instanceId: string | null) => {
    setState((s) => ({ ...s, selectedInstanceId: instanceId }));
  }, []);

  const addDefinition = useCallback((def: FixtureDefinition) => {
    setState((s) => ({ ...s, definitions: [...s.definitions, def] }));
  }, []);

  const updateDefinition = useCallback((def: FixtureDefinition) => {
    setState((s) => ({
      ...s,
      definitions: s.definitions.map((d) => (d.id === def.id ? def : d)),
    }));
  }, []);

  const removeDefinition = useCallback((defId: string) => {
    setState((s) => ({
      ...s,
      definitions: s.definitions.filter((d) => d.id !== defId),
      instances: s.instances.filter((i) => i.definitionId !== defId),
    }));
  }, []);

  const addInstance = useCallback((instance: FixtureInstance) => {
    setState((s) => ({ ...s, instances: [...s.instances, instance] }));
  }, []);

  const updateInstance = useCallback((instance: FixtureInstance) => {
    setState((s) => ({
      ...s,
      instances: s.instances.map((i) => (i.id === instance.id ? instance : i)),
    }));
  }, []);

  const removeInstance = useCallback((instanceId: string) => {
    setState((s) => ({
      ...s,
      instances: s.instances.filter((i) => i.id !== instanceId),
      selectedInstanceId: s.selectedInstanceId === instanceId ? null : s.selectedInstanceId,
    }));
  }, []);

  const getChannelValue = useCallback(
    (instanceId: string, channelId: string, fallback: number) =>
      state.liveValues[instanceId]?.[channelId] ?? fallback,
    [state.liveValues],
  );

  const setChannelValue = useCallback((instanceId: string, channelId: string, value: number) => {
    setState((s) => ({
      ...s,
      liveValues: {
        ...s.liveValues,
        [instanceId]: { ...s.liveValues[instanceId], [channelId]: value },
      },
    }));
  }, []);

  const setChannelValues = useCallback((values: ChannelValues) => {
    setState((s) => {
      const liveValues = { ...s.liveValues };
      for (const [instanceId, channels] of Object.entries(values)) {
        liveValues[instanceId] = { ...liveValues[instanceId], ...channels };
      }
      return { ...s, liveValues };
    });
  }, []);

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
      // La escena se construye completa ANTES de llamar a setState — no
      // dentro del updater. React no garantiza que el updater corra de
      // forma síncrona (es una optimización interna, no un contrato
      // público); cuando ya hay otras actualizaciones de estado pendientes
      // en el mismo tick (p. ej. moviste un fader justo antes), esa
      // suposición falla y el valor devuelto queda a medio construir.
      // `state` (closure del último render) es suficientemente reciente
      // para esto — no es una operación que necesite el estado "del
      // futuro" que solo existe dentro del updater.
      const scene: Scene = {
        id: makeId("scene"),
        name: name.trim() || "Sin nombre",
        values: captureSnapshot(state),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => ({ ...s, scenes: [...s.scenes, scene], activeSceneId: scene.id }));
      return scene;
    },
    [captureSnapshot, state],
  );

  /** Re-graba una escena existente con el estado actual del rig — "actualizar
   *  escena" en vez de crear una nueva, útil cuando ajustas una escena ya guardada. */
  const updateSceneValues = useCallback(
    (sceneId: string) => {
      setState((s) => ({
        ...s,
        scenes: s.scenes.map((sc) =>
          sc.id === sceneId ? { ...sc, values: captureSnapshot(s), updatedAt: Date.now() } : sc,
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
  }, []);

  const removeScene = useCallback((sceneId: string) => {
    setState((s) => ({
      ...s,
      scenes: s.scenes.filter((sc) => sc.id !== sceneId),
      activeSceneId: s.activeSceneId === sceneId ? null : s.activeSceneId,
      moments: s.moments.map((m) => (m.sceneId === sceneId ? { ...m, sceneId: null } : m)),
    }));
  }, []);

  /** Recall = merge, no blackout (ver comentario en types/scene.ts): solo
   *  pisa los instanceId/channelId que la escena capturó. */
  const recallScene = useCallback((sceneId: string) => {
    setState((s) => {
      const scene = s.scenes.find((sc) => sc.id === sceneId);
      if (!scene) return s;
      const liveValues: Record<string, Record<string, number>> = { ...s.liveValues };
      for (const [instanceId, channels] of Object.entries(scene.values)) {
        liveValues[instanceId] = { ...liveValues[instanceId], ...channels };
      }
      // Pedir una escena quita el Blackout: si no, el botón parecería roto.
      return { ...s, liveValues, activeSceneId: sceneId, blackoutActive: false };
    });
  }, []);

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
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setState((s) => ({
      ...s,
      groups: s.groups.filter((g) => g.id !== groupId),
      // Desagrupa a los fixtures que estaban en el grupo borrado, en vez
      // de dejarlos apuntando a un group.id que ya no existe.
      instances: s.instances.map((i) => (i.group === groupId ? { ...i, group: undefined } : i)),
    }));
  }, []);

  const setInstanceGroup = useCallback((instanceId: string, groupId: string | null) => {
    setState((s) => ({
      ...s,
      instances: s.instances.map((i) => (i.id === instanceId ? { ...i, group: groupId ?? undefined } : i)),
    }));
  }, []);

  /** Aplica un valor a todo canal de tipo `channelType` en todo fixture del
   *  grupo — cada fixture puede tener ese tipo de canal en un índice DMX
   *  distinto (LPC007 vs Orus), por eso se resuelve por tipo, no por id de
   *  canal fijo. Si un fixture del grupo no tiene ese tipo de canal, se
   *  omite silenciosamente (p. ej. subir "Gobo" en un grupo mixto que
   *  incluye PARs sin gobo). */
  const setGroupChannelByType = useCallback((groupId: string, channelType: string, value: number) => {
    setState((s) => {
      const liveValues: Record<string, Record<string, number>> = { ...s.liveValues };
      for (const instance of s.instances) {
        if (instance.group !== groupId) continue;
        const def = s.definitions.find((d) => d.id === instance.definitionId);
        if (!def) continue;
        for (const channel of def.channels) {
          if (channel.type !== channelType) continue;
          liveValues[instance.id] = { ...liveValues[instance.id], [channel.id]: value };
        }
      }
      return { ...s, liveValues };
    });
  }, []);

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
  }, []);

  const removeChase = useCallback((chaseId: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.filter((c) => c.id !== chaseId),
      moments: s.moments.map((m) => (m.chaseId === chaseId ? { ...m, chaseId: null } : m)),
    }));
  }, []);

  const setChaseLoop = useCallback((chaseId: string, loop: boolean) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) => (c.id === chaseId ? { ...c, loop, updatedAt: Date.now() } : c)),
    }));
  }, []);

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
  }, []);

  const removeChaseStep = useCallback((chaseId: string, stepId: string) => {
    setState((s) => ({
      ...s,
      chases: s.chases.map((c) =>
        c.id === chaseId
          ? { ...c, steps: c.steps.filter((st) => st.id !== stepId), updatedAt: Date.now() }
          : c,
      ),
    }));
  }, []);

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
  }, []);

  const addEffect = useCallback(
    (name: string): Effect => {
      // Mismo cuidado que en addChase/addGroup: el objeto se construye
      // ANTES de llamar a setState (ver comentario ahí — no depender de
      // que el updater corra de forma síncrona).
      const created: Effect = {
        id: makeId("effect"),
        name: name.trim() || `Effect ${state.effects.length + 1}`,
        groupId: null,
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
  }, []);

  const removeEffect = useCallback((effectId: string) => {
    setState((s) => ({
      ...s,
      effects: s.effects.filter((e) => e.id !== effectId),
      runningEffectIds: s.runningEffectIds.filter((id) => id !== effectId),
      moments: s.moments.map((m) => ({ ...m, effectIds: m.effectIds.filter((id) => id !== effectId) })),
    }));
  }, []);

  const updateEffect = useCallback((effectId: string, patch: Partial<Omit<Effect, "id" | "createdAt">>) => {
    setState((s) => ({
      ...s,
      effects: s.effects.map((e) => (e.id === effectId ? { ...e, ...patch, updatedAt: Date.now() } : e)),
    }));
  }, []);

  const startEffect = useCallback((effectId: string) => {
    setState((s) =>
      s.runningEffectIds.includes(effectId)
        ? s
        : { ...s, runningEffectIds: [...s.runningEffectIds, effectId] },
    );
  }, []);

  const stopEffect = useCallback((effectId: string) => {
    setState((s) => ({ ...s, runningEffectIds: s.runningEffectIds.filter((id) => id !== effectId) }));
  }, []);

  const blackout = useCallback(() => setState((s) => ({ ...s, blackoutActive: true })), []);
  const releaseBlackout = useCallback(() => setState((s) => ({ ...s, blackoutActive: false })), []);

  const setMaster = useCallback((value: number) => {
    setState((s) => ({ ...s, master: Math.max(0, Math.min(100, Math.round(value))) }));
  }, []);
  const setStrobe = useCallback((on: boolean) => setState((s) => ({ ...s, strobeActive: on })), []);

  const identifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identify = useCallback((instanceId: string) => {
    if (identifyTimer.current) clearTimeout(identifyTimer.current);
    setState((s) => ({ ...s, identifyId: instanceId }));
    identifyTimer.current = setTimeout(() => setState((s) => ({ ...s, identifyId: null })), IDENTIFY_MS);
  }, []);

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
  }, []);

  const removeMoment = useCallback((momentId: string) => {
    setState((s) => ({
      ...s,
      moments: s.moments.filter((m) => m.id !== momentId),
      ...(s.activeMomentId === momentId ? { activeMomentId: null, momentRun: null, runningEffectIds: [] } : {}),
    }));
  }, []);

  const moveMoment = useCallback((momentId: string, direction: -1 | 1) => {
    setState((s) => {
      const index = s.moments.findIndex((m) => m.id === momentId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= s.moments.length) return s;
      const moments = [...s.moments];
      [moments[index], moments[target]] = [moments[target], moments[index]];
      return { ...s, moments };
    });
  }, []);

  const addQuinceTemplate = useCallback(() => {
    const t = buildQuinceTemplate(stateRef.current, makeId);
    setState((s) => ({
      ...s,
      instances: t.instances,
      groups: t.groups,
      scenes: [...s.scenes, ...t.scenes],
      effects: [...s.effects, ...t.effects],
      moments: [...s.moments, ...t.moments],
    }));
  }, []);

  const startMoment = useCallback((momentId: string) => {
    const startedAt = Date.now();
    setState((s) => {
      const moment = s.moments.find((m) => m.id === momentId);
      if (!moment) return s;
      return {
        ...s,
        activeMomentId: momentId,
        momentRun: { nonce: (s.momentRun?.nonce ?? startedAt) + 1, startedAt },
        activeSceneId: moment.sceneId ?? s.activeSceneId,
        runningEffectIds: [],
        blackoutActive: false,
        strobeActive: false,
      };
    });
  }, []);

  const stepMoment = useCallback(
    (direction: -1 | 1) => {
      const { moments, activeMomentId } = stateRef.current;
      const next = moments[moments.findIndex((m) => m.id === activeMomentId) + direction];
      if (next) startMoment(next.id);
    },
    [startMoment],
  );

  const stopMoment = useCallback(() => {
    setState((s) => ({ ...s, momentRun: null, runningEffectIds: [] }));
  }, []);

  const selectedInstance = useMemo(
    () => state.instances.find((i) => i.id === state.selectedInstanceId) ?? null,
    [state.instances, state.selectedInstanceId],
  );
  const selectedDefinition = useMemo(
    () => state.definitions.find((d) => d.id === selectedInstance?.definitionId) ?? null,
    [state.definitions, selectedInstance],
  );

  const value: FixtureStoreValue = {
    ...state,
    selectedInstance,
    selectedDefinition,
    selectInstance,
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
    renameEffect,
    removeEffect,
    updateEffect,
    startEffect,
    stopEffect,
    blackout,
    releaseBlackout,
    setMaster,
    setStrobe,
    identify,
    addMoment,
    updateMoment,
    removeMoment,
    moveMoment,
    addQuinceTemplate,
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
