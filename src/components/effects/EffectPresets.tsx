import { useEffect, useMemo, useReducer, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { cn } from "@/lib/utils";
import { engineDoc, useFixtureStore } from "@/lib/fixtureStore";
import { EFFECT_PRESETS, groupHas, presetEffects, type EffectPreset } from "@/lib/effectPresets";
import { lookValues } from "@/lib/look";
import { PreviewShow } from "@/lib/preview";
import type { Group } from "@/types/group";

/** Efectos armados para elegir: se ven en el escenario antes de agregarlos. */
export function EffectPresets({ onAdded }: { onAdded: (effectId: string) => void }) {
  const store = useFixtureStore();
  const { groups, instances, addEffects } = store;
  const usable = groups.filter((g) => instances.some((i) => i.group === g.id));
  const [groupId, setGroupId] = useState(usable[0]?.id ?? "");
  const group = usable.find((g) => g.id === groupId) ?? usable[0];
  const presets = group ? EFFECT_PRESETS.filter((p) => groupHas(store, group.id, p.needs)) : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const preset = presets.find((p) => p.name === chosen) ?? presets[0];

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
    <Panel title="EFECTOS LISTOS" className="h-full">
      <div className="flex h-full min-h-0 gap-3">
        <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto">
          <label className="flex flex-col gap-1 text-xs text-text-secondary">
            Para
            <select
              value={group.id}
              onChange={(e) => {
                setGroupId(e.target.value);
                setChosen(null);
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
          {presets.map((p) => (
            <button
              key={p.name}
              type="button"
              aria-pressed={p === preset}
              onClick={() => setChosen(p.name)}
              className={cn(
                "rounded-control border px-3 py-2 text-left",
                p === preset ? "border-accent bg-accent/15" : "border-border bg-panel2 hover:bg-panel2/70",
              )}
            >
              <span className={cn("block text-sm", p === preset ? "text-accent" : "text-text-primary")}>{p.name}</span>
              <span className="block text-[11px] text-text-secondary">{p.text}</span>
            </button>
          ))}
          {presets.length === 0 ? (
            <p className="text-xs text-text-secondary">Las luces de este grupo no tienen dimmer, color ni pan.</p>
          ) : null}
        </div>

        {preset ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="min-h-0 flex-1 rounded-panel border border-accent bg-panel2 p-2">
              <PresetPreview key={`${group.id}/${preset.name}`} group={group} preset={preset} />
            </div>
            <p className="text-[11px] text-text-secondary">
              Así se ve en el escenario. Las luces no cambian hasta que lo pongas en un momento o lo prendas.
            </p>
            <Button
              variant="primary"
              className="self-start"
              onClick={() => onAdded(addEffects(presetEffects(preset, group))[0].id)}
            >
              Agregar “{group.name}: {preset.name.toLowerCase()}”
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/** El efecto corriendo en un motor aparte, con las luces del grupo encendidas. */
function PresetPreview({ group, preset }: { group: Group; preset: EffectPreset }) {
  const store = useFixtureStore();
  const [show, setShow] = useState<PreviewShow | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const drafts = useMemo(() => presetEffects(preset, group), [preset, group]);

  useEffect(() => {
    let alive = true;
    let started: PreviewShow | null = null;
    const effects = drafts.map((d, n) => ({ ...d, id: `vista-${n}`, createdAt: 0, updatedAt: 0 }));
    const doc = { ...engineDoc(store), effects: [...store.effects, ...effects] };
    const members = store.instances.filter((i) => i.group === group.id);
    // Solo este efecto, con el grupo encendido para que se vea.
    const lit = preset.needs === "DIMMER" ? {} : lookValues(members, store.definitions, { DIMMER: 255 });
    PreviewShow.start(
      { doc, liveValues: { ...store.liveValues, ...lit }, playback: { ...store, runningEffectIds: [], heldColors: {} } },
      redraw,
    )
      .then((s) => {
        started = s;
        if (!alive) return s.stop();
        for (const fx of effects) s.send({ type: "startEffect", id: fx.id });
        setShow(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
      started?.stop();
    };
    // Arranca una vez por efecto: cambiar de efecto cambia la key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return show ? <StageCanvas rig={show.rig} /> : null;
}
