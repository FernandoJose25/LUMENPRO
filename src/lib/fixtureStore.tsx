import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";

const STORAGE_KEY = "lumenpro.fixtures.v1";

interface FixtureStoreState {
  definitions: FixtureDefinition[];
  instances: FixtureInstance[];
  selectedInstanceId: string | null;
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
}

function loadInitialState(): FixtureStoreState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as FixtureStoreState;
  } catch {
    // localStorage no disponible o dato corrupto — se recurre a la semilla.
  }
  return { definitions: seedDefinitions, instances: seedInstances, selectedInstanceId: seedInstances[0]?.id ?? null };
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
  };

  return <FixtureStoreContext.Provider value={value}>{children}</FixtureStoreContext.Provider>;
}

export function useFixtureStore() {
  const ctx = useContext(FixtureStoreContext);
  if (!ctx) throw new Error("useFixtureStore debe usarse dentro de FixtureStoreProvider");
  return ctx;
}
