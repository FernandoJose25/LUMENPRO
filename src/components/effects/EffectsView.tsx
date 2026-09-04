import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { WAVEFORM_LABELS, type WaveformType } from "@/types/effect";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";

const WAVEFORMS = Object.keys(WAVEFORM_LABELS) as WaveformType[];
const CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABELS) as ChannelType[];

/**
 * Fase 4 — Effects: generadores paramétricos (ver types/effect.ts), a
 * diferencia de Chases que reproducen escenas fijas. El motor real vive
 * en lib/effectEngine.ts, montado una sola vez en App.tsx — esta vista
 * solo edita la configuración y hace start/stop.
 */
export function EffectsView() {
  const { effects, groups, addEffect, renameEffect, removeEffect } = useFixtureStore();
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(effects[0]?.id ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function handleCreate() {
    const name = window.prompt("Nombre del effect:", `Effect ${effects.length + 1}`);
    if (name === null) return;
    const created = addEffect(name);
    setSelectedEffectId(created.id);
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setDraftName(currentName);
  }

  function commitRename(id: string) {
    renameEffect(id, draftName);
    setRenamingId(null);
  }

  function handleDelete(id: string, name: string) {
    if (window.confirm(`¿Borrar el effect "${name}"?`)) {
      removeEffect(id);
      if (selectedEffectId === id) setSelectedEffectId(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-[260px] shrink-0">
        <Panel title="EFFECTS" className="h-full">
          {groups.length === 0 ? (
            <p className="mb-3 text-[11px] text-text-secondary">
              Un effect necesita un grupo objetivo — crea uno primero en{" "}
              <span className="text-text-primary">Groups</span>.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {effects.map((fx) => {
              const isSelected = fx.id === selectedEffectId;
              const isRenaming = renamingId === fx.id;

              if (isRenaming) {
                return (
                  <input
                    key={fx.id}
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(fx.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(fx.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-9 rounded-control border border-accent bg-panel2 px-2.5 text-sm text-text-primary outline-none"
                  />
                );
              }

              return (
                <div key={fx.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedEffectId(fx.id)}
                    onDoubleClick={() => startRename(fx.id, fx.name)}
                    title="Clic: seleccionar · Doble clic: renombrar"
                    className={cn(
                      "flex w-full items-center justify-between rounded-control border px-3 py-2 text-left text-sm",
                      isSelected
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border bg-panel2 text-text-primary hover:bg-panel2/70",
                    )}
                  >
                    <span className="truncate">{fx.name}</span>
                    <span className="text-[10px] text-text-secondary">{WAVEFORM_LABELS[fx.waveform]}</span>
                  </button>
                  <button
                    type="button"
                    title="Borrar effect"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(fx.id, fx.name);
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-panel2 text-[10px] text-text-secondary ring-1 ring-border hover:text-state-danger group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <Button size="md" variant="primary" className="mt-2 w-full" onClick={handleCreate}>
            + Nuevo effect
          </Button>
        </Panel>
      </div>

      <div className="min-w-0 flex-1">
        <EffectEditor effectId={selectedEffectId} />
      </div>
    </div>
  );
}

function EffectEditor({ effectId }: { effectId: string | null }) {
  const { effects, groups, runningEffectIds, updateEffect, startEffect, stopEffect } = useFixtureStore();
  const effect = effects.find((e) => e.id === effectId) ?? null;

  if (!effect) {
    return (
      <Panel title="EFFECT" className="h-full">
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          Selecciona o crea un effect a la izquierda.
        </div>
      </Panel>
    );
  }

  const isRunning = runningEffectIds.includes(effect.id);
  const group = groups.find((g) => g.id === effect.groupId) ?? null;

  return (
    <Panel title={`EFFECT — ${effect.name}`} className="h-full">
      <div className="mb-4 flex items-center gap-2">
        <Button
          size="md"
          variant={isRunning ? "danger" : "primary"}
          disabled={!effect.groupId}
          onClick={() => (isRunning ? stopEffect(effect.id) : startEffect(effect.id))}
        >
          {isRunning ? "■ Detener" : "▶ Reproducir"}
        </Button>
        {!effect.groupId ? (
          <span className="text-[11px] text-text-secondary">Asigna un grupo para poder reproducir.</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Grupo objetivo</span>
          <select
            value={effect.groupId ?? ""}
            onChange={(e) => updateEffect(effect.id, { groupId: e.target.value || null })}
            className="h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
          >
            <option value="">— sin grupo —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Tipo de canal</span>
          <select
            value={effect.channelType}
            onChange={(e) => updateEffect(effect.id, { channelType: e.target.value as ChannelType })}
            className="h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
          >
            {CHANNEL_TYPES.map((type) => (
              <option key={type} value={type}>
                {CHANNEL_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Forma de onda</span>
          <select
            value={effect.waveform}
            onChange={(e) => updateEffect(effect.id, { waveform: e.target.value as WaveformType })}
            className="h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
          >
            {WAVEFORMS.map((w) => (
              <option key={w} value={w}>
                {WAVEFORM_LABELS[w]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Velocidad (ciclos/min)</span>
          <input
            type="number"
            min={1}
            max={600}
            value={effect.speedCpm}
            onChange={(e) => updateEffect(effect.id, { speedCpm: Number(e.target.value) || 1 })}
            className="h-9 rounded-control border border-border bg-panel2 px-2 font-mono text-text-primary outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Mínimo (0-255)</span>
          <input
            type="number"
            min={0}
            max={255}
            value={effect.min}
            onChange={(e) =>
              updateEffect(effect.id, { min: Math.min(Number(e.target.value) || 0, effect.max) })
            }
            className="h-9 rounded-control border border-border bg-panel2 px-2 font-mono text-text-primary outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-text-secondary">Máximo (0-255)</span>
          <input
            type="number"
            min={0}
            max={255}
            value={effect.max}
            onChange={(e) =>
              updateEffect(effect.id, { max: Math.max(Number(e.target.value) || 0, effect.min) })
            }
            className="h-9 rounded-control border border-border bg-panel2 px-2 font-mono text-text-primary outline-none"
          />
        </label>

        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-text-secondary">
            Desfase entre fixtures (grados) — 0 = todos sincronizados, &gt;0 crea una ola
          </span>
          <input
            type="number"
            min={0}
            max={360}
            value={effect.phaseOffsetDeg}
            onChange={(e) => updateEffect(effect.id, { phaseOffsetDeg: Number(e.target.value) || 0 })}
            className="h-9 w-32 rounded-control border border-border bg-panel2 px-2 font-mono text-text-primary outline-none"
          />
        </label>
      </div>

      {group ? (
        <p className="mt-4 border-t border-border pt-3 text-[11px] text-text-secondary">
          Aplica a los fixtures de <span className="text-text-primary">{group.name}</span> que tengan un
          canal de tipo {CHANNEL_TYPE_LABELS[effect.channelType]}. El efecto sigue corriendo aunque
          navegues a otra sección del Sidebar — solo se detiene con "■ Detener" o borrando el effect.
        </p>
      ) : null}
    </Panel>
  );
}
