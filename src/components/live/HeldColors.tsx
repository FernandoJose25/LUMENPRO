import { useState } from "react";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { SWATCHES } from "@/lib/look";
import { colorRows } from "@/lib/palettes";

interface HeldColorsProps {
  /** Por defecto, los del show en vivo; la vista previa pasa los suyos. */
  heldColors?: Record<string, string>;
  onPick?: (groupId: string | null, hex: string | null) => void;
  /** En una sola línea: se elige el grupo y después el color. */
  compact?: boolean;
}

const EXPLAIN =
  "Pinta los efectos de color que corren (siguen igual, en este color). Dura hasta que cambias de momento; “Del momento” lo suelta antes.";

/**
 * Color fijo por grupo, encima de lo que haga el momento: los effects de
 * color quedan tapados y los de intensidad siguen. Dura hasta el próximo
 * momento o hasta que se prende a mano un effect de color del grupo. Los
 * momentos no se tocan: "Del momento" lo suelta y vuelve lo que tenían.
 */
export function HeldColors({ heldColors, onPick, compact }: HeldColorsProps) {
  const store = useFixtureStore();
  const held = heldColors ?? store.heldColors;
  const pick = onPick ?? store.holdColor;
  const rows = colorRows(store);
  const [targetId, setTargetId] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const allAre = (hex: string | null) =>
    hex === null ? Object.keys(held).length === 0 : rows.every((r) => held[r.id] === hex);
  const lines = [
    ...(rows.length > 1 ? [{ id: null, name: "Todas", is: allAre }] : []),
    ...rows.map((r) => ({ id: r.id as string | null, name: r.name, is: (hex: string | null) => (held[r.id] ?? null) === hex })),
  ];

  if (compact) {
    const target = lines.find((l) => l.id === targetId) ?? lines[0];
    // El color que tiene cada uno, para verlo sin elegirlo.
    const colorOf = (id: string | null) => (id === null ? SWATCHES.find((s) => allAre(s.hex))?.hex : held[id]);
    return (
      <section
        aria-label="Color fijo"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-border bg-panel px-3 py-2"
      >
        <span className="text-xs font-medium tracking-wide text-text-secondary" title={EXPLAIN}>
          COLOR FIJO
        </span>
        {lines.length > 1 ? (
          <div role="group" aria-label="Para qué luces" className="flex gap-1">
            {lines.map((line) => {
              const color = colorOf(line.id);
              return (
                <button
                  key={line.id ?? "*"}
                  type="button"
                  aria-label={`Color fijo para ${line.name}`}
                  aria-pressed={line === target}
                  onClick={() => setTargetId(line.id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-control border px-2.5 text-xs",
                    line === target ? "border-accent bg-accent/15 text-text-primary" : "border-border bg-panel2 text-text-secondary",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn("h-3 w-3 rounded-full border", color ? "border-border" : "border-dashed border-text-secondary")}
                    style={color ? { backgroundColor: color } : undefined}
                  />
                  {line.name}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          {SWATCHES.map(({ name, hex }) => (
            <button
              key={hex}
              type="button"
              aria-label={`${target.name}: ${name}`}
              aria-pressed={target.is(hex)}
              title={name}
              onClick={() => pick(target.id, hex)}
              className={cn(
                "h-7 w-7 rounded-control border hover:scale-110",
                target.is(hex) ? "border-text-primary ring-2 ring-accent" : "border-border",
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          <button
            type="button"
            aria-label={`${target.name}: Del momento`}
            aria-pressed={target.is(null)}
            onClick={() => pick(target.id, null)}
            className={cn(
              "h-7 rounded-control border px-2.5 text-xs",
              target.is(null) ? "border-accent bg-accent/15 text-accent" : "border-border bg-panel2 text-text-primary",
            )}
          >
            Del momento
          </button>
        </div>
        <span className="ml-auto text-[11px] text-text-secondary" title={EXPLAIN}>
          Pinta los efectos de color · dura hasta el próximo momento
        </span>
      </section>
    );
  }

  return (
    <section aria-label="Color fijo" className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-text-secondary">COLOR FIJO</span>
        <span className="text-[11px] text-text-secondary">{EXPLAIN}</span>
      </div>
      {lines.map((line) => (
        <div key={line.id ?? "*"} className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 shrink-0 truncate text-xs text-text-primary">{line.name}</span>
          {SWATCHES.map(({ name, hex }) => (
            <button
              key={hex}
              type="button"
              aria-label={`${line.name}: ${name}`}
              aria-pressed={line.is(hex)}
              title={name}
              onClick={() => pick(line.id, hex)}
              className={cn(
                "h-8 w-8 rounded-control border hover:scale-110",
                line.is(hex) ? "border-text-primary ring-2 ring-accent" : "border-border",
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          <button
            type="button"
            aria-label={`${line.name}: Del momento`}
            aria-pressed={line.is(null)}
            onClick={() => pick(line.id, null)}
            className={cn(
              "h-8 rounded-control border px-2.5 text-xs",
              line.is(null) ? "border-accent bg-accent/15 text-accent" : "border-border bg-panel2 text-text-primary",
            )}
          >
            Del momento
          </button>
        </div>
      ))}
    </section>
  );
}
