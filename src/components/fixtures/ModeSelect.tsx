import { useEffect, useState } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { loadDefinition, loadLibrary, type LibraryEntry } from "@/lib/library";
import type { FixtureDefinition } from "@/types/fixture";

/** Cambiar el modo de todas las unidades de un equipo de la biblioteca. Los
 *  canales que comparten los dos modos conservan su id, así que las escenas
 *  siguen valiendo. */
export function ModeSelect({ definition }: { definition: FixtureDefinition }) {
  const { definitions, instances, addDefinition, updateInstance } = useFixtureStore();
  const [entry, setEntry] = useState<LibraryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { library } = definition;

  useEffect(() => {
    if (!library) return;
    loadLibrary().then(
      (entries) => setEntry(entries.find((e) => e.maker === library.maker && e.model === library.model) ?? null),
      () => {}, // sin biblioteca no se puede cambiar, y no hay nada que avisar
    );
  }, [library]);

  if (!entry || entry.modes.length < 2) return null;

  async function change(mode: string) {
    if (!entry) return;
    try {
      const next = await loadDefinition(entry, mode);
      if (!definitions.some((d) => d.id === next.id)) addDefinition(next);
      for (const i of instances.filter((i) => i.definitionId === definition.id)) {
        updateInstance({ ...i, definitionId: next.id });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <select
        aria-label={`Modo de ${definition.model}`}
        title={error ?? "El modo del menú del equipo"}
        value={definition.mode}
        onChange={(e) => void change(e.target.value)}
        className="rounded border border-border bg-panel2 px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
      >
        {entry.modes.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} · {m.channels} canales
          </option>
        ))}
      </select>
    </>
  );
}
