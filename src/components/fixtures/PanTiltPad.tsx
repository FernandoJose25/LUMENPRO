import { useFixtureStore } from "@/lib/fixtureStore";
import { hasPanTilt, readAxis, writeAxis } from "@/lib/panTilt";
import type { FixtureInstance } from "@/types/fixture";

const KEY_STEP = 1 / 256;
const FINE_KEY_STEP = KEY_STEP / 8;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** Apuntar arrastrando. Mueve a la vez todas las cabezas que reciba; si no hay
 *  ninguna, no se muestra. Abajo es hacia el público, como en el simulador. */
export function PanTiltPad({ instances }: { instances: FixtureInstance[] }) {
  const { definitions, getChannelValue, setChannelValues } = useFixtureStore();

  const heads = instances.flatMap((instance) => {
    const definition = definitions.find((d) => d.id === instance.definitionId);
    if (!definition || !hasPanTilt(definition)) return [];
    const read = (axis: "PAN" | "TILT") =>
      readAxis(definition, axis, (c) => getChannelValue(instance.id, c.id, c.defaultValue));
    return [{ instance, definition, pan: read("PAN"), tilt: read("TILT") }];
  });
  if (heads.length === 0) return null;

  function aim(pan: number, tilt: number) {
    setChannelValues(
      Object.fromEntries(
        heads.map(({ instance, definition }) => [
          instance.id,
          { ...writeAxis(definition, "PAN", pan), ...writeAxis(definition, "TILT", tilt) },
        ]),
      ),
    );
  }

  function aimAt(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    aim((e.clientX - rect.left) / rect.width, 1 - (e.clientY - rect.top) / rect.height);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    const step = e.shiftKey ? FINE_KEY_STEP : KEY_STEP;
    aim(heads[0].pan + arrow[0] * step, heads[0].tilt + arrow[1] * step);
  }

  const percent = (v: number) => `${Math.round(v * 100)} %`;

  return (
    <div
      role="application"
      tabIndex={0}
      aria-label={`Pan y tilt: ${percent(heads[0].pan)}, ${percent(heads[0].tilt)}`}
      title="Arrastra para apuntar. Flechas: paso a paso. Shift + flechas: ajuste fino."
      className="relative h-36 shrink-0 cursor-crosshair touch-none select-none overflow-hidden rounded-control border border-border bg-panel2"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        aimAt(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) aimAt(e);
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border" aria-hidden />
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden />
      <span className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-text-secondary" aria-hidden>
        PAN / TILT
      </span>
      {heads.map(({ instance, pan, tilt }) => (
        <span
          key={instance.id}
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-accent"
          style={{ left: `${pan * 100}%`, top: `${(1 - tilt) * 100}%` }}
          aria-hidden
        />
      ))}
    </div>
  );
}
