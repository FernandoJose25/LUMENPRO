import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { SWATCHES } from "@/lib/look";
import { colorRows } from "@/lib/palettes";

interface HeldColorsProps {
  /** Por defecto, los del show en vivo; la vista previa pasa los suyos. */
  heldColors?: Record<string, string>;
  onPick?: (groupId: string | null, hex: string | null) => void;
}

/**
 * Color fijo por grupo, encima de lo que haga el momento: los effects de
 * color quedan tapados y los de intensidad siguen. Los momentos no se tocan:
 * "Del momento" lo suelta y vuelve lo que tenían.
 */
export function HeldColors({ heldColors, onPick }: HeldColorsProps) {
  const store = useFixtureStore();
  const held = heldColors ?? store.heldColors;
  const pick = onPick ?? store.holdColor;
  const rows = colorRows(store);
  if (rows.length === 0) return null;

  const allAre = (hex: string | null) =>
    hex === null ? Object.keys(held).length === 0 : rows.every((r) => held[r.id] === hex);
  const lines = [
    ...(rows.length > 1 ? [{ id: null, name: "Todas", is: allAre }] : []),
    ...rows.map((r) => ({ id: r.id as string | null, name: r.name, is: (hex: string | null) => (held[r.id] ?? null) === hex })),
  ];

  return (
    <section aria-label="Color fijo" className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-text-secondary">COLOR FIJO</span>
        <span className="text-[11px] text-text-secondary">
          Manda sobre el momento sin cambiarlo. “Del momento” lo suelta.
        </span>
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
