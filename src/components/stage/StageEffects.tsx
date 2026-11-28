import { useState } from "react";
import { cn } from "@/lib/utils";
import { describeEffect, effectShortName } from "@/lib/effectPresets";
import { effectKind, effectSections, KINDS } from "@/components/effects/EffectGroups";
import { EFFECT_SOURCE_LABELS, PIXEL_USES_COLOR2, type Effect } from "@/types/effect";
import type { Group } from "@/types/group";

type Kind = (typeof KINDS)[number]["id"];

/** Qué hace cada clase, para elegir sin probar uno por uno. */
const KIND_HELP: Record<Kind, string> = {
  move: "Mueven las cabezas alrededor de donde están apuntando.",
  color: "Cambian el color de las luces. Con Color fijo siguen igual, pero en ese color.",
  dimmer: "Juegan con el brillo: suben, bajan, laten o parpadean.",
};

/**
 * Los efectos en Escenario: un grupo de luces y una clase a la vez, cada uno
 * con lo que hace en una frase, y arriba lo que está prendido ahora.
 */
export function StageEffects({
  effects,
  groups,
  running,
  groupId,
  onGroup,
  selectedId,
  onPick,
  onSelect,
  onStop,
}: {
  effects: Effect[];
  groups: Group[];
  running: string[];
  /** El grupo que se ve ("" los que no tienen uno). */
  groupId: string | null;
  onGroup: (groupId: string) => void;
  /** El que tiene sus ajustes a la derecha. */
  selectedId: string | null;
  /** Tocar un efecto: lo prende o lo apaga y muestra sus ajustes. */
  onPick: (effect: Effect) => void;
  /** Solo mostrar sus ajustes. */
  onSelect: (effect: Effect) => void;
  onStop: (id: string) => void;
}) {
  const sections = effectSections(effects, groups);
  const [kindOf, setKindOf] = useState<Record<string, Kind>>({});
  if (sections.length === 0) return null;

  const section = sections.find((s) => s.id === groupId) ?? sections[0];
  const kinds = KINDS.map((k) => ({ ...k, effects: section.effects.filter((fx) => effectKind(fx) === k.id) })).filter(
    (k) => k.effects.length > 0,
  );
  const kind = kinds.find((k) => k.id === kindOf[section.id]) ?? kinds[0];
  const on = effects.filter((fx) => running.includes(fx.id));
  const groupName = (fx: Effect) => groups.find((g) => g.id === fx.groupId)?.name;

  /** Lleva a donde está el efecto y muestra sus ajustes. */
  function show(fx: Effect) {
    const s = sections.find((x) => x.effects.includes(fx));
    if (s) setKindOf({ ...kindOf, [s.id]: effectKind(fx) });
    onSelect(fx);
  }

  return (
    <section aria-label="Efectos" className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium tracking-wide text-text-secondary">EFECTOS</span>
        <div role="tablist" aria-label="Grupos de luces" className="flex flex-wrap gap-1">
          {sections.map((s) => {
            const count = s.effects.filter((fx) => running.includes(fx.id)).length;
            const selected = s === section;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onGroup(s.id)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-control border px-3 text-xs font-medium",
                  selected ? "border-accent bg-accent/15 text-text-primary" : "border-border bg-panel2 text-text-secondary hover:text-text-primary",
                )}
              >
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.name}
                {count > 0 ? <span className="font-mono text-[10px] text-accent">● {count}</span> : null}
              </button>
            );
          })}
        </div>

        <div aria-label="Prendidos ahora" className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          <span className="text-[11px] text-text-secondary">{on.length === 0 ? "Ninguno prendido" : "Prendidos:"}</span>
          {on.map((fx) => (
            <span key={fx.id} className="flex h-7 items-center rounded-control border border-accent/50 bg-accent/10 text-xs">
              <button
                type="button"
                title="Ver sus ajustes"
                onClick={() => show(fx)}
                className="flex h-full items-center gap-1 pl-2 pr-1 text-text-primary hover:underline"
              >
                {effectShortName(fx.name, groupName(fx))}
                <span className="text-[10px] text-text-secondary">{groupName(fx)}</span>
              </button>
              <button
                type="button"
                aria-label={`Apagar ${fx.name}`}
                title="Apagar"
                onClick={() => onStop(fx.id)}
                className="h-full rounded-r-control px-1.5 text-text-secondary hover:bg-state-danger hover:text-white"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
        <div role="tablist" aria-label="Qué hacen" className="flex gap-1">
          {kinds.map((k) => {
            const count = k.effects.filter((fx) => running.includes(fx.id)).length;
            const selected = k === kind;
            return (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setKindOf({ ...kindOf, [section.id]: k.id })}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-control px-2.5 text-xs",
                  selected ? "bg-panel2 font-medium text-text-primary" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {k.name}
                <span className="font-mono text-[10px] text-text-secondary">{k.effects.length}</span>
                {count > 0 ? <span className="font-mono text-[10px] text-accent">● {count}</span> : null}
              </button>
            );
          })}
        </div>
        <span className="text-[11px] text-text-secondary">{KIND_HELP[kind.id]}</span>
      </div>

      <div
        role="tabpanel"
        aria-label={`${section.name}: ${kind.name}`}
        className="grid max-h-52 auto-rows-max grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-1.5 overflow-y-auto pr-1 scrollbar-thin"
      >
        {kind.effects.map((fx) => (
          <EffectCard
            key={fx.id}
            effect={fx}
            groupName={section.id ? section.name : undefined}
            running={running.includes(fx.id)}
            selected={fx.id === selectedId}
            onClick={() => onPick(fx)}
          />
        ))}
      </div>
    </section>
  );
}

function EffectCard({
  effect,
  groupName,
  running,
  selected,
  onClick,
}: {
  effect: Effect;
  groupName?: string;
  running: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const text = describeEffect(effect, groupName);
  const second = effect.kind === "pixels" && PIXEL_USES_COLOR2.includes(effect.pattern ?? "rainbow") ? effect.color2 : null;
  const colors = effect.kind === "figure" ? [] : [effect.color, second].filter((c): c is string => Boolean(c));
  return (
    <button
      type="button"
      aria-label={effect.name}
      aria-pressed={running}
      title={`${text}\n${
        running
          ? selected
            ? "Toca para apagarlo."
            : "Está prendido: toca para ver sus ajustes (no se apaga)."
          : "Toca para prenderlo; sus ajustes quedan a la derecha."
      }`}
      onClick={onClick}
      className={cn(
        "flex min-h-[3.4rem] flex-col items-start gap-0.5 rounded-control border px-2.5 py-1.5 text-left transition-colors",
        running ? "border-accent bg-accent/20" : "border-border bg-panel2 hover:border-text-secondary",
        selected && "ring-2 ring-text-primary",
      )}
    >
      <span className="flex w-full items-center gap-1.5">
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", running ? "bg-accent" : "bg-border")} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {effectShortName(effect.name, groupName)}
        </span>
        {colors.map((c, i) => (
          <span key={i} aria-hidden className="h-3 w-3 shrink-0 rounded-full border border-border" style={{ backgroundColor: c }} />
        ))}
        {effect.source !== "clock" ? (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent">♪ {EFFECT_SOURCE_LABELS[effect.source]}</span>
        ) : null}
      </span>
      <span className="line-clamp-2 text-[11px] leading-snug text-text-secondary">{text}</span>
    </button>
  );
}
