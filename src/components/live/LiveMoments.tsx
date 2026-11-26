import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useFixtureStore } from "@/lib/fixtureStore";
import { askConfirm } from "@/lib/dialogs";

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Los momentos del evento: uno por botón y "Siguiente" para no tener que
 *  buscar. AvPág/RePág también avanzan y retroceden, que es lo que envía un
 *  pasador de diapositivas inalámbrico. */
export function LiveMoments() {
  const { moments, activeMomentId, momentRun, startMoment, stepMoment, stopMoment } = useFixtureStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || (e.key !== "PageDown" && e.key !== "PageUp")) return;
      e.preventDefault();
      stepMoment(e.key === "PageDown" ? 1 : -1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stepMoment]);

  if (moments.length === 0) return null;

  const activeIndex = moments.findIndex((m) => m.id === activeMomentId);
  const next = moments[activeIndex + 1];

  return (
    <section
      aria-label="Momentos"
      className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-3"
    >
      <div className="flex items-stretch gap-2">
        <Button size="lg" disabled={activeIndex <= 0} onClick={() => stepMoment(-1)}>
          ◀ Anterior
        </Button>
        <Button size="lg" variant="primary" className="flex-1" disabled={!next} onClick={() => stepMoment(1)}>
          {next ? `Siguiente: ${next.name} ▶` : "Fin del evento"}
        </Button>
        <Button size="lg" disabled={!momentRun} onClick={stopMoment}>
          ■ Detener
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {moments.map((m) => (
          <Button
            key={m.id}
            selected={m.id === activeMomentId}
            className={m.id === activeMomentId ? "bg-accent/15 text-accent" : undefined}
            onClick={() => startMoment(m.id)}
          >
            {m.name}
          </Button>
        ))}
      </div>
      <MomentStatus />
    </section>
  );
}

function MomentStatus() {
  const { moments, activeMomentId, momentRun, saveToMoment } = useFixtureStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!momentRun) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [momentRun]);

  const index = moments.findIndex((m) => m.id === activeMomentId);
  const moment = moments[index];
  if (!moment) return <p className="text-[11px] text-text-secondary">Ningún momento lanzado todavía.</p>;
  if (!momentRun) {
    return <p className="text-[11px] text-text-secondary">{moment.name} — detenido. Tócalo para retomarlo.</p>;
  }

  const elapsed = now - momentRun.startedAt;
  const next = moments[index + 1];
  return (
    <div className="flex items-center gap-3">
      <p className="flex-1 font-mono text-[11px] text-text-secondary">
        {moment.name} · {clock(elapsed)}
        {next && moment.durationSec !== null
          ? ` · pasa a ${next.name} en ${clock(moment.durationSec * 1000 - elapsed)}`
          : null}
      </p>
      <Button
        size="sm"
        variant="ghost"
        title="Lo que cambiaste en vivo (colores, dimmer, posición) queda en el momento"
        onClick={() =>
          askConfirm(
            `¿Guardar cómo están las luces ahora en «${moment.name}»? La próxima vez que lo lances se verá así. Sus efectos siguen igual.`,
            "Guardar",
            () => saveToMoment(moment.id),
          )
        }
      >
        Guardar cambios en «{moment.name}»
      </Button>
    </div>
  );
}
