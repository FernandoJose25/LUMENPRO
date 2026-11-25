import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { defaultPlacements, isHead } from "@/lib/stage";
import { openStageWindow } from "@/lib/stageMirror";
import type { FixtureInstance, Placement } from "@/types/fixture";
import { StageCanvas } from "./StageCanvas";

/** Coloca las luces como van a estar en el evento y mira cómo se ve. */
export function StageView() {
  const store = useFixtureStore();
  const { instances, definitions, updateInstance, moments, activeMomentId, startMoment } = store;
  const [windowError, setWindowError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const defaults = useMemo(() => defaultPlacements(instances, definitions), [instances, definitions]);
  const placementOf = (i: FixtureInstance) => i.placement ?? defaults.get(i.id);

  function place(i: FixtureInstance, patch: Partial<Placement>) {
    const placement = placementOf(i);
    if (placement) updateInstance({ ...i, placement: { ...placement, ...patch } });
  }

  const selected = instances.find((i) => i.id === selectedId);

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-h-0 flex-1 rounded-panel border border-border bg-panel p-2">
          <StageCanvas
            rig={store}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, position) => {
              const moved = instances.find((i) => i.id === id);
              if (moved) place(moved, position);
            }}
          />
        </div>
        {moments.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 rounded-panel border border-border bg-panel p-2">
            {moments.map((m) => (
              <Button key={m.id} selected={m.id === activeMomentId} onClick={() => startMoment(m.id)}>
                {m.name}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-3">
          <p className="flex-1 text-[11px] text-text-secondary">
            Arrastra una luz para moverla y el fondo para girar la vista. Rueda: acercar. Doble clic: vista inicial. No
            simula gobos ni prisma.
          </p>
          <Button
            size="sm"
            onClick={() => {
              setWindowError(null);
              openStageWindow().catch((e) => setWindowError(String(e)));
            }}
          >
            Abrir en otra pantalla
          </Button>
        </div>
        {windowError ? (
          <p role="alert" className="shrink-0 text-xs text-state-danger">
            {windowError}
          </p>
        ) : null}
      </div>

      <div className="w-72 shrink-0">
        <Panel title="LUCES">
          <div className="flex flex-col gap-1">
            {instances.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelectedId(i.id)}
                className={cn(
                  "truncate rounded-control border px-2.5 py-1.5 text-left text-xs",
                  i.id === selectedId
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-panel2 text-text-primary",
                )}
              >
                {i.label}
              </button>
            ))}
          </div>
          {selected ? (
            <PlacementEditor
              key={selected.id}
              instance={selected}
              head={definitions.some((d) => d.id === selected.definitionId && isHead(d))}
              placement={placementOf(selected)}
              onPlace={(patch) => place(selected, patch)}
              onChange={(patch) => updateInstance({ ...selected, ...patch })}
            />
          ) : (
            <p className="mt-3 text-xs text-text-secondary">Elige una luz para ubicarla.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function PlacementEditor({
  instance,
  head,
  placement,
  onPlace,
  onChange,
}: {
  instance: FixtureInstance;
  head: boolean;
  placement: Placement | undefined;
  onPlace: (patch: Partial<Placement>) => void;
  onChange: (patch: Partial<FixtureInstance>) => void;
}) {
  if (!placement) return null;
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 text-xs text-text-secondary">
      <Slider label="Izquierda / derecha" unit="m" min={-7} max={7} step={0.1} value={placement.x} onChange={(x) => onPlace({ x })} />
      <Slider label="Fondo / público" unit="m" min={-7} max={7} step={0.1} value={placement.z} onChange={(z) => onPlace({ z })} />
      <Slider label="Altura" unit="m" min={0} max={6} step={0.1} value={placement.y} onChange={(y) => onPlace({ y })} />
      <Slider label="Giro" unit="°" min={-180} max={180} step={5} value={placement.yaw} onChange={(yaw) => onPlace({ yaw })} />
      {head ? (
        <>
          <Check label="Colgada de un truss" checked={placement.hung} onChange={(hung) => onPlace({ hung })} />
          <p className="text-[11px]">Si la cabeza real se mueve al revés que aquí:</p>
          <Check label="Invertir pan" checked={instance.panInvert ?? false} onChange={(panInvert) => onChange({ panInvert })} />
          <Check label="Invertir tilt" checked={instance.tiltInvert ?? false} onChange={(tiltInvert) => onChange({ tiltInvert })} />
        </>
      ) : (
        <Slider label="Inclinación" unit="°" min={-90} max={90} step={5} value={placement.pitch} onChange={(pitch) => onPlace({ pitch })} />
      )}
      <Button size="sm" variant="ghost" onClick={() => onChange({ placement: undefined })}>
        Volver a la posición inicial
      </Button>
    </div>
  );
}

function Slider({
  label,
  unit,
  value,
  onChange,
  ...range
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between">
        {label}
        <span className="font-mono text-text-primary">
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-accent"
        {...range}
      />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-text-primary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      {label}
    </label>
  );
}
