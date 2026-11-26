import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { askConfirm, askText } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import {
  EFFECT_SOURCE_LABELS,
  FIGURE_LABELS,
  WAVEFORM_LABELS,
  type Effect,
  type EffectSource,
  type FigureType,
  type WaveformType,
} from "@/types/effect";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";
import { EffectPresets } from "./EffectPresets";
import { factoryEffect } from "@/lib/factory";

const WAVEFORMS = Object.keys(WAVEFORM_LABELS) as WaveformType[];
const SOURCES = Object.keys(EFFECT_SOURCE_LABELS) as EffectSource[];
const CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABELS) as ChannelType[];
const FIGURES = Object.keys(FIGURE_LABELS) as FigureType[];

const fieldClass = "h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none";

/** El mismo cálculo que show-engine (Figure::at), para dibujarla. */
function figureAt(figure: FigureType, phase: number, place: number): [number, number] {
  const a = 2 * Math.PI * (phase - Math.floor(phase));
  switch (figure) {
    case "eight":
      return [Math.sin(a), Math.sin(2 * a) / 2];
    case "line":
      return [Math.sin(a), 0];
    case "fan":
      return [place * (0.5 - 0.5 * Math.cos(a)), 0];
    default:
      return [Math.sin(a), Math.cos(a)];
  }
}

/** Cómo se moverá cada cabeza: abajo es hacia el público, como en el pad. */
function FigurePreview({ effect, heads }: { effect: Effect; heads: number }) {
  const count = Math.max(1, Math.min(heads, 8));
  const [sin, cos] = [Math.sin((effect.angleDeg * Math.PI) / 180), Math.cos((effect.angleDeg * Math.PI) / 180)];
  const paths = Array.from({ length: count }, (_, h) => {
    const place = count > 1 ? (2 * h) / (count - 1) - 1 : 0;
    const steps = effect.figure === "fan" ? [0.5] : Array.from({ length: 65 }, (_, i) => i / 64);
    if (effect.figure === "fan") {
      const [x] = figureAt("fan", 0.5, place);
      return `M50,50 L${50 + 40 * x * cos},${50 - 40 * x * sin}`;
    }
    const offset = (h * effect.phaseOffsetDeg) / 360;
    return steps
      .map((t, i) => {
        const [x, y] = figureAt(effect.figure, t + offset, place);
        return `${i === 0 ? "M" : "L"}${(50 + 40 * (x * cos - y * sin)).toFixed(1)},${(50 - 40 * (x * sin + y * cos)).toFixed(1)}`;
      })
      .join(" ");
  });
  return (
    <svg viewBox="0 0 100 100" className="h-36 w-36 rounded-control border border-border bg-panel2" role="img" aria-label={`Figura: ${FIGURE_LABELS[effect.figure]}`}>
      <line x1="50" y1="0" x2="50" y2="100" className="stroke-border" />
      <line x1="0" y1="50" x2="100" y2="50" className="stroke-border" />
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" strokeWidth={2} className="stroke-accent" opacity={1 - i * 0.08} />
      ))}
    </svg>
  );
}

/**
 * Fase 4 — Effects: generadores paramétricos (ver types/effect.ts), a
 * diferencia de Chases que reproducen escenas fijas. Los mueve
 * el motor (show-engine/) — esta vista solo edita la configuración y hace
 * start/stop.
 */
export function EffectsView() {
  const { effects, groups, addEffect, renameEffect, removeEffect } = useFixtureStore();
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(effects[0]?.id ?? null);
  const [inPresets, setInPresets] = useState(effects.length === 0);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function handleCreate() {
    askText("Nombre del effect", `Effect ${effects.length + 1}`, (name) => {
      setSelectedEffectId(addEffect(name).id);
      setInPresets(false);
    });
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
    askConfirm(`¿Borrar el effect "${name}"?`, "Borrar", () => {
      removeEffect(id);
      if (selectedEffectId === id) setSelectedEffectId(null);
    });
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
                    onClick={() => {
                      setSelectedEffectId(fx.id);
                      setInPresets(false);
                    }}
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
                    <span className="text-[10px] text-text-secondary">{fx.kind === "figure" ? FIGURE_LABELS[fx.figure] : WAVEFORM_LABELS[fx.waveform]}</span>
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
          <Button size="md" variant="primary" className="mt-2 w-full" onClick={() => setInPresets(true)}>
            + Efectos listos
          </Button>
          <Button size="md" className="mt-2 w-full" onClick={handleCreate}>
            + Nuevo effect
          </Button>
        </Panel>
      </div>

      <div className="min-w-0 flex-1">
        {inPresets ? (
          <EffectPresets
            onAdded={(id) => {
              setSelectedEffectId(id);
              setInPresets(false);
            }}
          />
        ) : (
          <EffectEditor effectId={selectedEffectId} />
        )}
      </div>
    </div>
  );
}

function EffectEditor({ effectId }: { effectId: string | null }) {
  const store = useFixtureStore();
  const { effects, groups, instances, runningEffectIds, updateEffect, startEffect, stopEffect } = store;
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
        <FactoryButton
          factory={factoryEffect(store, effect)}
          name={effect.name}
          onReset={(draft) => updateEffect(effect.id, draft)}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-text-secondary">Qué hace</span>
          <select
            value={effect.kind}
            onChange={(e) => updateEffect(effect.id, { kind: e.target.value as Effect["kind"] })}
            className={fieldClass}
          >
            <option value="wave">Sube y baja un canal (dimmer, colores…)</option>
            <option value="figure">Las cabezas dibujan una figura</option>
          </select>
        </label>
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

        {effect.kind === "figure" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Figura</span>
              <select
                value={effect.figure}
                onChange={(e) => updateEffect(effect.id, { figure: e.target.value as FigureType })}
                className={fieldClass}
              >
                {FIGURES.map((f) => (
                  <option key={f} value={f}>
                    {FIGURE_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Tamaño (grados desde el centro)</span>
              <input
                type="number"
                min={1}
                max={180}
                value={effect.sizeDeg}
                onChange={(e) => updateEffect(effect.id, { sizeDeg: Math.max(1, Number(e.target.value) || 1) })}
                className={`${fieldClass} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-text-secondary">Giro de la figura (grados)</span>
              <input
                type="number"
                min={-180}
                max={180}
                value={effect.angleDeg}
                onChange={(e) => updateEffect(effect.id, { angleDeg: Number(e.target.value) || 0 })}
                className={`${fieldClass} font-mono`}
              />
            </label>
            <div className="row-span-3 flex items-start">
              <FigurePreview effect={effect} heads={instances.filter((i) => i.group === effect.groupId).length} />
            </div>
          </>
        ) : null}

        <label className={cn("flex flex-col gap-1", effect.kind === "figure" && "hidden")}>
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

        <label className={cn("flex flex-col gap-1", effect.kind === "figure" && "hidden")}>
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
          <span className="text-text-secondary">Sigue a</span>
          <select
            value={effect.source}
            onChange={(e) => updateEffect(effect.id, { source: e.target.value as EffectSource })}
            className="h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {EFFECT_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>

        {effect.source === "beat" ? (
          <label className="flex flex-col gap-1">
            <span className="text-text-secondary">Golpes por ciclo</span>
            <input
              type="number"
              min={1}
              max={64}
              value={effect.beatsPerCycle}
              onChange={(e) => updateEffect(effect.id, { beatsPerCycle: Math.max(1, Number(e.target.value) || 1) })}
              className="h-9 rounded-control border border-border bg-panel2 px-2 font-mono text-text-primary outline-none"
            />
          </label>
        ) : (
          <span className="self-end pb-2 text-[11px] text-text-secondary">
            {effect.source === "clock"
              ? null
              : effect.kind === "figure"
                ? "Con música la figura crece y se achica según cuánto suene."
                : "Con música va del mínimo al máximo según cuánto suene; la forma de onda y la velocidad solo se usan sin música."}
          </span>
        )}

        <label className={cn("flex flex-col gap-1", effect.kind === "figure" && "hidden")}>
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

        <label className={cn("flex flex-col gap-1", effect.kind === "figure" && "hidden")}>
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
          {effect.kind === "figure" ? (
            <>
              Mueve las cabezas de <span className="text-text-primary">{group.name}</span> alrededor de donde estén
              apuntando, sin tocar sus faders: con el pad o una posición se mueve el centro.
            </>
          ) : (
            <>
              Aplica a los fixtures de <span className="text-text-primary">{group.name}</span> que tengan un canal de
              tipo {CHANNEL_TYPE_LABELS[effect.channelType]}.
            </>
          )} El efecto sigue corriendo aunque
          navegues a otra sección del Sidebar — solo se detiene con "■ Detener" o borrando el effect.
        </p>
      ) : null}
    </Panel>
  );
}

/** Vuelve el effect a como vino de la plantilla o de los efectos listos. */
function FactoryButton({
  factory,
  name,
  onReset,
}: {
  factory: ReturnType<typeof factoryEffect>;
  name: string;
  onReset: (draft: NonNullable<ReturnType<typeof factoryEffect>>) => void;
}) {
  if (!factory) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="ml-auto"
      title="Vuelve velocidad, colores, figura y todo lo demás a como venía"
      onClick={() => askConfirm(`¿Restablecer "${name}" a como venía?`, "Restablecer", () => onReset(factory))}
    >
      Restablecer
    </Button>
  );
}
