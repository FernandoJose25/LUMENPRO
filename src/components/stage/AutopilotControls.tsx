import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { autopilotOf, INTENSITIES, intensityOf, type Autopilot } from "@/lib/autopilot";

/** Cómo suena la música ahora, para saber qué va a elegir el piloto. */
export function IntensityPill({ intensity }: { intensity: -1 | 0 | 1 | null }) {
  if (intensity === null) {
    return (
      <span className="text-[11px] text-text-secondary" title="Toca ▶ Escuchar en Audio Reactive (o pon música en Música)">
        Música: sin escuchar
      </span>
    );
  }
  const i = intensityOf(intensity);
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-text-primary" aria-label={`Música ${i.name.toLowerCase()}`}>
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: i.color }} />
      Música {i.name.toLowerCase()}
    </span>
  );
}

/**
 * Piloto automático (de sound-to-light-osc): elige solo un momento de la fila
 * de cómo suena la música y cambia al empezar un compás.
 */
export function AutopilotControls({
  on,
  intensity,
  onToggle,
}: {
  on: boolean;
  intensity: -1 | 0 | 1 | null;
  onToggle: (on: boolean) => void;
}) {
  const store = useFixtureStore();
  const pilot = autopilotOf(store);
  const [open, setOpen] = useState(false);
  const active = intensity === null ? "normal" : intensityOf(intensity).id;

  function flip(list: keyof Autopilot, id: string) {
    const ids = pilot[list];
    store.setAutopilot({ ...pilot, [list]: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  }

  return (
    <>
      <div className="ml-auto flex items-center gap-2">
        <IntensityPill intensity={intensity} />
        <Button
          size="sm"
          variant={on ? "primary" : "secondary"}
          aria-pressed={on}
          title="Cambia solo de momento según cómo suena la música, siempre al empezar un compás. Elegir un momento a mano lo apaga."
          onClick={() => onToggle(!on)}
        >
          Piloto automático
        </Button>
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          Ajustar
        </Button>
      </div>
      {open ? (
        <section aria-label="Piloto automático" className="flex basis-full flex-col gap-1.5 border-t border-border pt-2">
          <p className="text-[11px] text-text-secondary">
            Marca en cada fila los momentos que van con esa música. El piloto elige uno de la fila de cómo suena ahora y
            cambia al empezar un compás: cuando la música cambia, o después de 32 tiempos para no repetir. Necesita oír el
            ritmo (o el TAP); sin ritmo se queda donde está. Elegir un momento a mano lo apaga.
          </p>
          {INTENSITIES.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-1.5">
              <span className={cn("flex w-44 shrink-0 items-center gap-1.5 text-xs", on && active === i.id ? "font-semibold text-text-primary" : "text-text-secondary")}>
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: i.color }} />
                {i.name}
                <span className="truncate text-[10px] font-normal text-text-secondary">{i.hint}</span>
              </span>
              {store.moments.map((m) => {
                const chosen = pilot[i.id].includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    aria-label={`${i.name}: ${m.name}`}
                    aria-pressed={chosen}
                    onClick={() => flip(i.id, m.id)}
                    className={cn(
                      "h-7 rounded-control border px-2 text-xs",
                      chosen ? "border-accent bg-accent/20 text-text-primary" : "border-border bg-panel2 text-text-secondary",
                    )}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
