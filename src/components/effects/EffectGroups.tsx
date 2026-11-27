import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { Effect } from "@/types/effect";
import type { Group } from "@/types/group";

interface Section {
  /** "" para los que no tienen grupo. */
  id: string;
  name: string;
  color: string;
  effects: Effect[];
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
}: {
  effects: Effect[];
  groups: Group[];
  running: string[];
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
                  {on.length > 0 ? <span className="text-accent">{on.length} prendido{on.length === 1 ? "" : "s"} · </span> : null}
                  {s.effects.length}
                </span>
              </button>
              {onStopAll && on.length > 0 ? (
                <Button size="sm" variant="ghost" title={`Apaga los effects de ${s.name}`} onClick={() => onStopAll(on.map((fx) => fx.id))}>
                  ■ Apagar
                </Button>
              ) : null}
            </div>
            {open ? <div className={itemsClassName}>{s.effects.map(children)}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
