import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { EFFECT_CATEGORIES, presetEffects, presetsFor, type EffectCategory, type EffectPreset } from "@/lib/effectPresets";
import { EffectPreview } from "./EffectPreview";
import type { Group } from "@/types/group";

/** Efectos armados para elegir, por tipo de luz: se ven en el escenario antes de agregarlos. */
export function EffectPresets({ onAdded }: { onAdded: (effectId: string) => void }) {
  const store = useFixtureStore();
  const { groups, instances, addEffects } = store;
  const usable = groups.filter((g) => instances.some((i) => i.group === g.id));
  const [groupId, setGroupId] = useState(usable[0]?.id ?? "");
  const group = usable.find((g) => g.id === groupId) ?? usable[0];
  const presets = group ? presetsFor(store, group.id) : [];
  // null: el primero; "": ninguno.
  const [chosen, setChosen] = useState<string | null>(null);
  const preset = chosen === "" ? undefined : (presets.find((p) => p.name === chosen) ?? presets[0]);
  const categories = EFFECT_CATEGORIES.map((c) => ({ ...c, presets: presets.filter((p) => p.category === c.id) })).filter(
    (c) => c.presets.length > 0,
  );
  // Abierta la del efecto elegido; las demás, con su botón.
  const [open, setOpen] = useState<Set<EffectCategory>>(new Set());
  const isOpen = (id: EffectCategory) => open.has(id) || preset?.category === id;
  function toggle(id: EffectCategory) {
    const next = new Set(open);
    if (!isOpen(id)) next.add(id);
    else {
      next.delete(id);
      // El elegido queda adentro: pasa al primero de otra abierta, o a ninguno.
      if (preset?.category === id) setChosen(categories.find((c) => c.id !== id && next.has(c.id))?.presets[0].name ?? "");
    }
    setOpen(next);
  }

  if (!group) {
    return (
      <Panel title="EFECTOS LISTOS" className="h-full">
        <p className="text-xs text-text-secondary">
          Primero junta tus luces en grupos (Groups), por ejemplo "PAR" y "Cabezas". La plantilla de quinceañera los
          arma sola.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={`EFECTOS LISTOS · ${presets.length} para ${group.name}`} className="h-full">
      <div className="flex h-full min-h-0 gap-3">
        <div className="flex w-80 shrink-0 flex-col gap-2 overflow-y-auto pr-1">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Para
            <select
              value={group.id}
              onChange={(e) => {
                setGroupId(e.target.value);
                setChosen(null);
                setOpen(new Set());
              }}
              className="h-9 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary"
            >
              {usable.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {categories.map((c) => (
            <section key={c.id} aria-label={c.name} className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-expanded={isOpen(c.id)}
                onClick={() => toggle(c.id)}
                className="flex items-center gap-2 rounded-control border border-border bg-panel px-3 py-2 text-left text-xs font-medium text-text-primary hover:bg-panel2"
              >
                <span aria-hidden className="w-3 text-accent">
                  {isOpen(c.id) ? "▾" : "▸"}
                </span>
                <span className="flex-1">{c.name}</span>
                <span className="font-mono text-[10px] text-text-secondary">{c.presets.length}</span>
              </button>
              {isOpen(c.id)
                ? c.presets.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      aria-pressed={p === preset}
                      onClick={() => setChosen(p.name)}
                      className={cn(
                        "ml-3 rounded-control border px-3 py-2 text-left",
                        p === preset ? "border-accent bg-accent/15" : "border-border bg-panel2 hover:bg-panel2/70",
                      )}
                    >
                      <span className={cn("block text-sm", p === preset ? "text-accent" : "text-text-primary")}>{p.name}</span>
                      <span className="block text-[11px] text-text-secondary">{p.text}</span>
                    </button>
                  ))
                : null}
            </section>
          ))}
          {presets.length === 0 ? (
            <p className="text-xs text-text-secondary">Las luces de este grupo no tienen dimmer, color ni pan.</p>
          ) : null}
        </div>

        {preset ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs text-text-secondary">
              <span className="font-medium text-accent">VISTA PREVIA</span> · {preset.name}: así se ve en el escenario.
              Las luces no cambian hasta que lo pongas en un momento o lo prendas.
            </p>
            <div className="min-h-0 flex-1 rounded-panel border border-accent bg-panel2 p-2">
              <PresetPreview key={`${group.id}/${preset.name}`} group={group} preset={preset} />
            </div>
            <Button
              variant="primary"
              className="self-start"
              onClick={() => onAdded(addEffects(presetEffects(preset, group))[0].id)}
            >
              Agregar “{group.name}: {preset.name.toLowerCase()}”
            </Button>
          </div>
        ) : (
          <p className="flex flex-1 items-center justify-center text-xs text-text-secondary">
            Abre un grupo y toca un efecto para verlo.
          </p>
        )}
      </div>
    </Panel>
  );
}

function PresetPreview({ group, preset }: { group: Group; preset: EffectPreset }) {
  const effects = useMemo(
    () => presetEffects(preset, group).map((d, n) => ({ ...d, id: `vista-${n}`, createdAt: 0, updatedAt: 0 })),
    [preset, group],
  );
  return <EffectPreview effects={effects} />;
}
