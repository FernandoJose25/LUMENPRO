import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Scene } from "@/types/scene";
import type { Group } from "@/types/group";
import { GROUP_COLORS } from "@/types/group";
import type { Chase, ChaseStep } from "@/types/chase";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const STORAGE_KEY = "lumenpro.fixtures.v1";

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
}

function loadInitialState(): FixtureStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FixtureStoreState>;
      // Migración suave: sesiones guardadas antes de que existieran
      // liveValues/scenes no deben romper el load, solo completan con vacío.
      return {
        definitions: parsed.definitions ?? seedDefinitions,
        instances: parsed.instances ?? seedInstances,
        selectedInstanceId: parsed.selectedInstanceId ?? seedInstances[0]?.id ?? null,
        liveValues: parsed.liveValues ?? {},
        scenes: parsed.scenes ?? [],
        activeSceneId: parsed.activeSceneId ?? null,
        groups: parsed.groups ?? [],
        chases: parsed.chases ?? [],
      };
    }
  } catch {
    // localStorage no disponible o dato corrupto — se recurre a la semilla.
  }
  return {
    definitions: seedDefinitions,
    instances: seedInstances,
    selectedInstanceId: seedInstances[0]?.id ?? null,
    liveValues: {},
    scenes: [],
    activeSceneId: null,
    groups: [],
    chases: [],
  };
}

const FixtureStoreContext = createContext<FixtureStoreValue | null>(null);

/**
 * Persistencia real vía localStorage — es un placeholder deliberado
 * (ver AUDIT.md §7): cuando exista el motor Tauri+SQLite, este hook se
 * reemplaza por comandos `invoke()` sin tocar los componentes que lo
 * consumen, porque la forma (definitions/instances/acciones) es la misma.
 */
export function FixtureStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FixtureStoreState>(loadInitialState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Si falla el guardado (modo privado, cuota llena), se sigue en memoria.
    }
  }, [state]);

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
      return { ...s, liveValues, activeSceneId: sceneId };
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
    setState((s) => ({ ...s, chases: s.chases.filter((c) => c.id !== chaseId) }));
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
  };

  return <FixtureStoreContext.Provider value={value}>{children}</FixtureStoreContext.Provider>;
}

export function useFixtureStore() {
  const ctx = useContext(FixtureStoreContext);
  if (!ctx) throw new Error("useFixtureStore debe usarse dentro de FixtureStoreProvider");
  return ctx;
}
