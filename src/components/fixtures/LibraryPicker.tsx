import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { channelCount, nextFreeAddress } from "@/lib/dmxFrame";
import { useFixtureStore } from "@/lib/fixtureStore";
import { loadDefinition, loadLibrary, searchLibrary, type LibraryEntry } from "@/lib/library";

/** Con la lista entera la pantalla se arrastra; nadie mira más que esto. */
const SHOWN = 80;

const KIND_LABELS: Record<string, string> = {
  "Color Changer": "PAR / color",
  "Moving Head": "Cabeza móvil",
  Scanner: "Scanner",
  Flower: "Flower",
  "LED Bar (Beams)": "Barra de beams",
  "LED Bar (Pixels)": "Barra de píxeles",
  Strobe: "Estrobo",
  Laser: "Láser",
  Smoke: "Humo",
  Hazer: "Haze",
  Effect: "Efecto",
  Dimmer: "Dimmer",
  Fan: "Ventilador",
  Other: "Otro",
};

const inputClass =
  "rounded-control border border-border bg-panel2 px-3 py-1.5 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** Elegir un equipo de la biblioteca de QLC+ por marca, modelo y modo. */
export function LibraryPicker({ onClose }: { onClose: () => void }) {
  const { definitions, instances, addDefinition, addInstance } = useFixtureStore();
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LibraryEntry | null>(null);
  const [mode, setMode] = useState("");
  const [count, setCount] = useState(1);

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    loadLibrary().then(setEntries, fail);
  }, []);

  const found = useMemo(() => searchLibrary(entries ?? [], query), [entries, query]);
  const channels = selected?.modes.find((m) => m.name === mode)?.channels ?? 0;

  function select(entry: LibraryEntry) {
    setSelected(entry);
    setMode(entry.modes[0]?.name ?? "");
    setError(null);
  }

  async function add() {
    if (!selected) return;
    try {
      const definition = await loadDefinition(selected, mode);
      // Si ya estaba, puede tener correcciones hechas a mano: no se pisa.
      const existing = definitions.find((d) => d.id === definition.id);
      if (!existing) addDefinition(definition);
      const used = existing ?? definition;
      const before = instances.filter((i) => i.definitionId === used.id).length;
      const patch = [...instances];
      for (let n = 0; n < count; n++) {
        const instance = {
          id: `inst-${crypto.randomUUID()}`,
          definitionId: used.id,
          label: `${used.model.toUpperCase()} #${before + n + 1}`,
          universe: 1,
          address: nextFreeAddress(patch, [...definitions, used], channelCount(used)),
        };
        patch.push(instance);
        addInstance(instance);
      }
      onClose();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <Panel title="BIBLIOTECA DE EQUIPOS" className="h-full">
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex gap-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Marca o modelo (por ejemplo: LPC007, Chauvet, beam 280)"
            aria-label="Buscar en la biblioteca"
            className={cn(inputClass, "flex-1")}
          />
          <Button onClick={onClose}>Volver</Button>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-state-danger">
            {error}
          </p>
        ) : null}
        <p className="text-[11px] text-text-secondary" role="status">
          {entries === null
            ? "Cargando…"
            : `${found.length} ${found.length === 1 ? "equipo" : "equipos"}${found.length > SHOWN ? ` · se muestran ${SHOWN}` : ""}`}
        </p>

        <ul aria-label="Equipos" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin rounded-control border border-border">
          {found.slice(0, SHOWN).map((entry) => (
            <li key={`${entry.maker}/${entry.model}`}>
              <button
                type="button"
                aria-pressed={entry === selected}
                onClick={() => select(entry)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm hover:bg-panel2",
                  entry === selected && "bg-accent/15 text-accent",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-text-secondary">{entry.maker}</span> {entry.model}
                </span>
                <span className="shrink-0 text-[11px] text-text-secondary">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3 text-xs text-text-secondary">
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              Modo (el del menú del equipo)
              <select value={mode} onChange={(e) => setMode(e.target.value)} className={cn(inputClass, "h-9")}>
                {selected.modes.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name} · {m.channels} canales
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Cuántos
              <input
                type="number"
                min={1}
                max={64}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(64, Number(e.target.value) || 1)))}
                className={cn(inputClass, "h-9 w-20")}
              />
            </label>
            <Button variant="primary" onClick={() => void add()} disabled={channels === 0}>
              Agregar
            </Button>
          </div>
        ) : null}

        <p className="text-[11px] text-text-secondary">
          Perfiles de QLC+ (Apache 2.0). Compara el modo con el menú de tu equipo: si no coincide, las funciones caen en
          otro canal.
        </p>
      </div>
    </Panel>
  );
}
