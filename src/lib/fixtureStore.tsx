import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Scene } from "@/types/scene";
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
      const scene: Scene = {
        id: makeId("scene"),
        name: name.trim() || "Sin nombre",
        values: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setState((s) => {
        scene.values = captureSnapshot(s);
        return { ...s, scenes: [...s.scenes, scene], activeSceneId: scene.id };
      });
      return scene;
    },
    [captureSnapshot],
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
  };

  return <FixtureStoreContext.Provider value={value}>{children}</FixtureStoreContext.Provider>;
}

export function useFixtureStore() {
  const ctx = useContext(FixtureStoreContext);
  if (!ctx) throw new Error("useFixtureStore debe usarse dentro de FixtureStoreProvider");
  return ctx;
}
