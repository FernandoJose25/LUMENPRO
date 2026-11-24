import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { Moment } from "@/types/moment";

const fieldClass =
  "h-9 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** Arma el orden del evento. Se lanzan desde Live. */
export function MomentsView() {
  const { moments, activeMomentId, addMoment, moveMoment, removeMoment, addQuinceTemplate } = useFixtureStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = moments.find((m) => m.id === selectedId) ?? moments[0];

  function handleCreate() {
    const name = window.prompt("Nombre del momento:", `Momento ${moments.length + 1}`);
    if (name !== null) setSelectedId(addMoment(name).id);
  }

  function handleDelete(m: Moment) {
    if (window.confirm(`¿Borrar el momento "${m.name}"? No borra su escena ni sus effects.`)) removeMoment(m.id);
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-80 shrink-0">
        <Panel title="MOMENTOS DEL EVENTO">
          <ol className="flex flex-col gap-1.5">
            {moments.map((m, index) => (
              <li
                key={m.id}
                className={cn(
                  "flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-sm",
                  m === selected ? "border-accent bg-accent/15" : "border-border bg-panel2",
                )}
              >
                <span className="w-5 shrink-0 font-mono text-xs text-text-secondary">{index + 1}</span>
                <button
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-left",
                    m.id === activeMomentId ? "text-accent" : "text-text-primary",
                  )}
                >
                  {m.name}
                </button>
                <RowButton label={`Subir ${m.name}`} disabled={index === 0} onClick={() => moveMoment(m.id, -1)}>
                  ↑
                </RowButton>
                <RowButton
                  label={`Bajar ${m.name}`}
                  disabled={index === moments.length - 1}
                  onClick={() => moveMoment(m.id, 1)}
                >
                  ↓
                </RowButton>
                <RowButton label={`Borrar ${m.name}`} onClick={() => handleDelete(m)}>
                  ×
                </RowButton>
              </li>
            ))}
          </ol>
          <Button variant="primary" className="mt-2 w-full" onClick={handleCreate}>
            + Nuevo momento
          </Button>
          {moments.length === 0 ? (
            <>
              <Button className="mt-2 w-full" onClick={addQuinceTemplate}>
                Usar plantilla de quinceañera
              </Button>
              <p className="mt-2 text-[11px] text-text-secondary">
                Crea Recepción, Entrada, Vals, Fotos, Brindis, Hora loca y Cierre con las luces que tienes
                patcheadas. Después puedes cambiar todo.
              </p>
            </>
          ) : null}
        </Panel>
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          <MomentEditor key={selected.id} moment={selected} />
        ) : (
          <Panel title="MOMENTO">
            <p className="text-xs text-text-secondary">
              Un momento junta una escena, un chase y effects en un solo botón.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function RowButton({
  label,
  ...props
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="text-text-secondary hover:text-text-primary disabled:opacity-30"
      {...props}
    />
  );
}

function MomentEditor({ moment }: { moment: Moment }) {
  const { scenes, chases, effects, updateMoment, startMoment } = useFixtureStore();
  const update = (patch: Partial<Omit<Moment, "id">>) => updateMoment(moment.id, patch);

  return (
    <Panel title={`MOMENTO — ${moment.name}`}>
      <div className="flex max-w-xl flex-col gap-4 text-xs text-text-secondary">
        <label className="flex flex-col gap-1">
          Nombre
          <input value={moment.name} onChange={(e) => update({ name: e.target.value })} className={fieldClass} />
        </label>

        <label className="flex flex-col gap-1">
          Escena
          <select
            value={moment.sceneId ?? ""}
            onChange={(e) => update({ sceneId: e.target.value || null })}
            className={fieldClass}
          >
            <option value="">Dejar las luces como estén</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="text-[11px]">
            Todo lo que la escena no define vuelve a su valor inicial: el estrobo de un momento no pasa al siguiente.
          </span>
        </label>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1">Effects</legend>
          {effects.length === 0 ? <span className="text-[11px]">Todavía no hay effects.</span> : null}
          {effects.map((fx) => (
            <label key={fx.id} className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                className="accent-accent"
                checked={moment.effectIds.includes(fx.id)}
                onChange={(e) =>
                  update({
                    effectIds: e.target.checked
                      ? [...moment.effectIds, fx.id]
                      : moment.effectIds.filter((id) => id !== fx.id),
                  })
                }
              />
              {fx.name}
              {!fx.groupId ? <span className="text-[11px] text-state-warn">sin grupo, no hace nada</span> : null}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-col gap-1">
          Chase
          <select
            value={moment.chaseId ?? ""}
            onChange={(e) => update({ chaseId: e.target.value || null })}
            className={fieldClass}
          >
            <option value="">Ninguno</option>
            {chases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-4">
          <label className="flex flex-col gap-1">
            Transición (segundos)
            <input
              type="number"
              min={0}
              step={0.5}
              value={moment.fadeMs / 1000}
              onChange={(e) => update({ fadeMs: Math.max(0, Number(e.target.value)) * 1000 })}
              className={`${fieldClass} w-32`}
            />
          </label>
          <label className="flex flex-col gap-1">
            Pasar solo al siguiente (minutos)
            <input
              type="number"
              min={0}
              step={0.5}
              placeholder="Esperar a Siguiente"
              value={moment.durationSec === null ? "" : moment.durationSec / 60}
              onChange={(e) => {
                const minutes = Number(e.target.value);
                update({ durationSec: minutes > 0 ? minutes * 60 : null });
              }}
              className={`${fieldClass} w-48`}
            />
          </label>
        </div>

        <Button variant="primary" size="lg" className="self-start" onClick={() => startMoment(moment.id)}>
          ▶ Probar
        </Button>
      </div>
    </Panel>
  );
}
