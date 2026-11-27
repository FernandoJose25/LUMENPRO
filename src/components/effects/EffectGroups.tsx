import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { Effect } from "@/types/effect";
import { COLOR_CHANNEL_TYPES } from "@/types/fixture";
import type { Group } from "@/types/group";

/** Los de un grupo abierto; si hay de varias clases, con un título por clase. */
function Kinds({
  effects,
  itemsClassName,
  render,
}: {
  effects: Effect[];
  itemsClassName: string;
  render: (effect: Effect) => ReactNode;
}) {
  const parts = KINDS.map((k) => ({ ...k, effects: effects.filter((fx) => effectKind(fx) === k.id) })).filter(
    (k) => k.effects.length > 0,
  );
  if (parts.length < 2) return <div className={itemsClassName}>{effects.map(render)}</div>;
  return (
    <>
      {parts.map((k) => (
        <div key={k.id} className="flex flex-col gap-1">
          <span className="pl-1 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
            {k.name} · {k.effects.length}
          </span>
          <div className={itemsClassName}>{k.effects.map(render)}</div>
        </div>
      ))}
    </>
  );
}

interface Section {
  /** "" para los que no tienen grupo. */
  id: string;
  name: string;
  color: string;
  effects: Effect[];
}

/** Dentro de un grupo, por lo que hacen. */
export const KINDS = [
  { id: "move", name: "Movimiento" },
  { id: "color", name: "Colores" },
  { id: "dimmer", name: "Brillo y estrobo" },
] as const;

export function effectKind(fx: Effect): (typeof KINDS)[number]["id"] {
  if (fx.kind === "figure") return "move";
  if (fx.kind === "pixels" || COLOR_CHANNEL_TYPES.includes(fx.channelType)) return "color";
  return "dimmer";
}

/** Los effects juntados por el grupo de luces que mueven, en el orden de los grupos. */
export function effectSections(effects: Effect[], groups: Group[]): Section[] {
  const sections: Section[] = groups.map((g) => ({ ...g, effects: effects.filter((fx) => fx.groupId === g.id) }));
  const loose = effects.filter((fx) => !groups.some((g) => g.id === fx.groupId));
  sections.push({ id: "", name: "Sin grupo", color: "#6b7280", effects: loose });
  return sections.filter((s) => s.effects.length > 0);
}

/**
 * Un botón por grupo (PAR, Cabezas, Barras…) que despliega sus effects, con
 * cuántos están prendidos aunque esté cerrado.
 */
export function EffectGroups({
  effects,
  groups,
  running,
  isOpen,
  onToggle,
  onStopAll,
  children,
  itemsClassName = "flex flex-col gap-1.5",
  onLabel = ["prendido", "prendidos"],
}: {
  effects: Effect[];
  groups: Group[];
  /** Los que se cuentan en el botón del grupo (los prendidos). */
  running: string[];
  onLabel?: [string, string];
  isOpen: (sectionId: string) => boolean;
  onToggle: (sectionId: string) => void;
  /** Con esto, cada grupo con algo prendido tiene "Apagar". */
  onStopAll?: (ids: string[]) => void;
  children: (effect: Effect) => ReactNode;
  itemsClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {effectSections(effects, groups).map((s) => {
        const on = s.effects.filter((fx) => running.includes(fx.id));
        const open = isOpen(s.id);
        return (
          <section key={s.id} aria-label={`Efectos de ${s.name}`} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => onToggle(s.id)}
                className="flex min-h-9 flex-1 items-center gap-2 rounded-control border border-border bg-panel px-3 py-1.5 text-left text-xs font-medium text-text-primary hover:bg-panel2"
              >
                <span aria-hidden className="w-3 text-accent">
                  {open ? "▾" : "▸"}
                </span>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="flex-1 truncate">{s.name}</span>
                <span className="font-mono text-[10px] font-normal text-text-secondary">
                  {on.length > 0 ? (
                    <span className="text-accent">
                      {on.length} {on.length === 1 ? onLabel[0] : onLabel[1]} ·{" "}
                    </span>
                  ) : null}
                  {s.effects.length}
                </span>
              </button>
              {onStopAll && on.length > 0 ? (
                <Button size="sm" variant="ghost" title={`Apaga los effects de ${s.name}`} onClick={() => onStopAll(on.map((fx) => fx.id))}>
                  ■ Apagar
                </Button>
              ) : null}
            </div>
            {open ? <Kinds effects={s.effects} itemsClassName={itemsClassName} render={children} /> : null}
          </section>
        );
      })}
    </div>
  );
}
