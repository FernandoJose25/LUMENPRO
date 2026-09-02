import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import { FixtureEditor } from "./FixtureEditor";

interface FixtureManagerProps {
  onOpenControl: (instanceId: string) => void;
}

/**
 * Sección 9 — lista de fixtures agrupada por modelo con contador
 * ("BEAM 280 ORUS   4"), búsqueda y "+ ADD FIXTURE". Expandir un grupo
 * muestra las instancias individuales con su dirección/universe.
 */
export function FixtureManager({ onOpenControl }: FixtureManagerProps) {
  const {
    definitions,
    instances,
    addInstance,
    updateInstance,
    removeInstance,
    addDefinition,
  } = useFixtureStore();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(definitions[0]?.id ?? null);
  const [editingDef, setEditingDef] = useState<FixtureDefinition | "new" | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return definitions
      .map((def) => ({
        def,
        count: instances.filter((i) => i.definitionId === def.id).length,
      }))
      .filter(
        ({ def }) =>
          !q ||
          def.model.toLowerCase().includes(q) ||
          def.manufacturer.toLowerCase().includes(q),
      );
  }, [definitions, instances, query]);

  if (editingDef) {
    return (
      <FixtureEditor
        definition={editingDef === "new" ? null : editingDef}
        onSave={(def) => {
          if (editingDef === "new") addDefinition(def);
          setEditingDef(null);
        }}
        onCancel={() => setEditingDef(null)}
      />
    );
  }

  return (
    <Panel title="FIXTURES" className="h-full">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Fixture..."
        className="mb-3 w-full rounded-control border border-border bg-panel2 px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary outline-none focus-visible:outline-2 focus-visible:outline-accent"
      />

      <div className="flex flex-col gap-1">
        {groups.map(({ def, count }) => (
          <div key={def.id} className="rounded-control border border-border">
            <button
              type="button"
              onClick={() => setExpanded(expanded === def.id ? null : def.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-panel2"
            >
              <span className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{def.model.toUpperCase()}</span>
                {!def.verified ? (
                  <span
                    className="rounded-full bg-state-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-state-warn"
                    title={def.verifiedNote}
                  >
                    SIN VERIFICAR
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-xs text-text-secondary">{count}</span>
            </button>

            {expanded === def.id ? (
              <div className="border-t border-border p-2">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[11px] uppercase tracking-wide text-text-secondary">
                    {def.manufacturer}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingDef(def)}>
                    Editar perfil
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {instances
                    .filter((i) => i.definitionId === def.id)
                    .map((inst) => (
                      <InstanceRow
                        key={inst.id}
                        instance={inst}
                        onChange={updateInstance}
                        onRemove={() => removeInstance(inst.id)}
                        onOpenControl={() => onOpenControl(inst.id)}
                      />
                    ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1 justify-start text-text-secondary"
                    onClick={() =>
                      addInstance({
                        id: `inst-${crypto.randomUUID()}`,
                        definitionId: def.id,
                        label: `${def.model.toUpperCase()} #${count + 1}`,
                        universe: 1,
                        address: 1,
                      })
                    }
                  >
                    + Agregar unidad
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <Button variant="primary" className="w-full" onClick={() => setEditingDef("new")}>
          + ADD FIXTURE
        </Button>
      </div>
    </Panel>
  );
}

function InstanceRow({
  instance,
  onChange,
  onRemove,
  onOpenControl,
}: {
  instance: FixtureInstance;
  onChange: (i: FixtureInstance) => void;
  onRemove: () => void;
  onOpenControl: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-control px-2 py-1.5 text-xs hover:bg-panel2">
      <button
        type="button"
        onClick={onOpenControl}
        className="flex-1 truncate text-left text-text-primary hover:text-accent"
        title="Abrir en Fixture Control"
      >
        {instance.label}
      </button>
      <span className="text-text-secondary">Universe</span>
      <input
        type="number"
        min={1}
        value={instance.universe}
        onChange={(e) => onChange({ ...instance, universe: Number(e.target.value) || 1 })}
        className="w-10 rounded border border-border bg-panel2 px-1 py-0.5 text-center font-mono text-text-primary"
      />
      <span className="text-text-secondary">DMX</span>
      <input
        type="number"
        min={1}
        max={512}
        value={instance.address}
        onChange={(e) => onChange({ ...instance, address: Number(e.target.value) || 1 })}
        className="w-12 rounded border border-border bg-panel2 px-1 py-0.5 text-center font-mono text-text-primary"
      />
      <button
        type="button"
        onClick={onRemove}
        className="px-1 text-text-secondary hover:text-state-danger"
        aria-label={`Eliminar ${instance.label}`}
      >
        ×
      </button>
    </div>
  );
}
