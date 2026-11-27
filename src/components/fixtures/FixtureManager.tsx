import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { askConfirm, askText } from "@/lib/dialogs";
import { factoryDefinition, hasFactoryDefinition } from "@/lib/factory";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";
import { channelCount, isTwin, nextFreeSlot } from "@/lib/dmxFrame";
import { ChannelFinder } from "./ChannelFinder";
import { emptyChannel, FixtureEditor } from "./FixtureEditor";
import { LibraryPicker } from "./LibraryPicker";
import { ModeSelect } from "./ModeSelect";

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
    updateDefinition,
  } = useFixtureStore();

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(definitions[0]?.id ?? null);
  const [editingDef, setEditingDef] = useState<FixtureDefinition | "new" | null>(null);
  const [finderId, setFinderId] = useState<string | null>(null);
  const [inLibrary, setInLibrary] = useState(false);

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

  /** Un equipo del que solo se sabe cuántos canales usa. */
  function addUnknown() {
    askText("Nombre del equipo", "Barra LED", (model) => {
      if (!model) return;
      askText("¿Cuántos canales usa? (en su menú: 16CH, 26CH…)", "16", (text) => {
        const count = Number(text);
        if (Number.isInteger(count) && count >= 1 && count <= 512) createUnknown(model, count);
      });
    });
  }

  function createUnknown(model: string, count: number) {
    const definitionId = `def-${crypto.randomUUID()}`;
    const instanceId = `inst-${crypto.randomUUID()}`;
    addDefinition({
      id: definitionId,
      manufacturer: "Sin identificar",
      model,
      verified: false,
      verifiedNote: "Canales por identificar mirando la luz.",
      channels: Array.from({ length: count }, (_, i) => ({ ...emptyChannel(i + 1), name: `Canal ${i + 1}` })),
    });
    addInstance({
      id: instanceId,
      definitionId,
      label: `${model.toUpperCase()} #1`,
      ...nextFreeSlot(instances, definitions, count),
    });
    setFinderId(instanceId);
  }

  /** Una tira de LEDs (WLED o similar): tantos puntos RGB como diga, cada uno
   *  con su color. Por Art-Net o sACN entran hasta 170 en un universo. */
  function addStrip() {
    askText("¿Cuántos puntos (LEDs) tiene la tira? Hasta 170 por universo.", "60", (text) => {
      const count = Number(text);
      if (!Number.isInteger(count) || count < 1 || count > 170) return;
      const definitionId = `def-${crypto.randomUUID()}`;
      const channels: FixtureChannel[] = [];
      const heads: string[][] = [];
      const colors = [["RED", "Rojo"], ["GREEN", "Verde"], ["BLUE", "Azul"]] as const;
      for (let p = 0; p < count; p++) {
        const head = colors.map(([type, name], k) => ({ ...emptyChannel(p * 3 + k + 1), type, name: `${name} ${p + 1}` }));
        channels.push(...head);
        heads.push(head.map((c) => c.id));
      }
      addDefinition({
        id: definitionId,
        manufacturer: "WLED",
        model: `Tira de LEDs (${count} puntos)`,
        kind: "LED Bar (Pixels)",
        mode: `${count * 3} canales RGB`,
        channels,
        heads,
        verified: false,
        verifiedNote: "En WLED: Config → Sync Interfaces → E1.31 (sACN) o Art-Net, con el mismo universo y la dirección de inicio que aquí.",
      });
      addInstance({
        id: `inst-${crypto.randomUUID()}`,
        definitionId,
        label: `TIRA LED #${instances.filter((i) => i.label.startsWith("TIRA LED")).length + 1}`,
        ...nextFreeSlot(instances, definitions, count * 3),
      });
    });
  }

  if (finderId) return <ChannelFinder instanceId={finderId} onClose={() => setFinderId(null)} />;

  if (inLibrary) return <LibraryPicker onClose={() => setInLibrary(false)} />;

  if (editingDef) {
    return (
      <FixtureEditor
        definition={editingDef === "new" ? null : editingDef}
        onSave={(def) => {
          if (editingDef === "new") addDefinition(def);
          else updateDefinition(def);
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
                {def.mode ? <span className="text-[11px] text-text-secondary">{def.mode}</span> : null}
                {!def.verified ? (
                  <span
                    className="rounded-full bg-state-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-state-warn"
                    title={`${def.verifiedNote ?? ""} Cuando la pruebes con la luz real y todo haga lo que dice, márcala como probada.`.trim()}
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
                  <ModeSelect definition={def} />
                  <Button size="sm" variant="ghost" onClick={() => setEditingDef(def)}>
                    Editar perfil
                  </Button>
                  {hasFactoryDefinition(def) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Los canales como vienen de fábrica, sin tus cambios"
                      onClick={() =>
                        askConfirm(
                          `¿Restablecer el perfil de ${def.model}? Sus canales vuelven a como vienen de fábrica y se pierden los cambios que les hiciste. Las direcciones no cambian.`,
                          "Restablecer",
                          () => void factoryDefinition(def).then((fresh) => fresh && updateDefinition(fresh)),
                        )
                      }
                    >
                      Restablecer
                    </Button>
                  ) : null}
                </div>
                <label className="mb-2 flex items-center gap-2 px-1 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={def.verified}
                    onChange={(e) => updateDefinition({ ...def, verified: e.target.checked })}
                  />
                  Ya la probé con la luz real: cada canal hace lo que dice
                </label>
                <div className="flex flex-col gap-1">
                  {instances
                    .filter((i) => i.definitionId === def.id)
                    .map((inst) => (
                      <InstanceRow
                        key={inst.id}
                        instance={inst}
                        twin={instances.find((o) => o.id !== inst.id && isTwin(o, inst))}
                        onChange={updateInstance}
                        onRemove={() => removeInstance(inst.id)}
                        onOpenControl={() => onOpenControl(inst.id)}
                        onFindChannels={() => setFinderId(inst.id)}
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
                        ...nextFreeSlot(instances, definitions, Math.max(1, channelCount(def))),
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
        <Button variant="primary" className="w-full" onClick={() => setInLibrary(true)}>
          + Elegir de la biblioteca
        </Button>
        <Button className="mt-2 w-full" onClick={() => setEditingDef("new")}>
          + ADD FIXTURE
        </Button>
        <Button className="mt-2 w-full" onClick={addUnknown}>
          + Equipo sin manual
        </Button>
        <Button className="mt-2 w-full" onClick={addStrip}>
          + Tira de LEDs (WLED)
        </Button>
      </div>
    </Panel>
  );
}

function InstanceRow({
  instance,
  twin,
  onChange,
  onRemove,
  onOpenControl,
  onFindChannels,
}: {
  instance: FixtureInstance;
  /** Otra en la misma dirección: van juntas. */
  twin: FixtureInstance | undefined;
  onChange: (i: FixtureInstance) => void;
  onRemove: () => void;
  onOpenControl: () => void;
  onFindChannels: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-control px-2 py-1.5 text-xs hover:bg-panel2">
      <button
        type="button"
        onClick={onOpenControl}
        className="min-w-0 flex-1 truncate text-left text-text-primary hover:text-accent"
        title="Abrir en Fixture Control"
      >
        {instance.label}
        {twin ? (
          <span
            className="ml-2 text-[10px] text-accent"
            title="Misma dirección y mismo modelo: el cable les manda lo mismo, así que hacen siempre lo mismo."
          >
            va junto con {twin.label}
          </span>
        ) : null}
      </button>
      <Button size="sm" variant="ghost" aria-label={`Identificar canales de ${instance.label}`} onClick={onFindChannels}>
        Canales
      </Button>
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
