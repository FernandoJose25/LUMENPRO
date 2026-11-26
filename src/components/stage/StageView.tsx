import { useEffect, useMemo, useReducer, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { askConfirm } from "@/lib/dialogs";
import { cn } from "@/lib/utils";
import { engineDoc, useFixtureStore } from "@/lib/fixtureStore";
import { PreviewShow } from "@/lib/preview";
import { HeldColors } from "@/components/live/HeldColors";
import type { EngineMessage } from "@/types/engine";
import type { ChannelValues } from "@/lib/fade";
import { readAxis, writeAxis } from "@/lib/panTilt";
import { aimAt, defaultPlacements, isHead, type Vec3 } from "@/lib/stage";
import { openStageWindow } from "@/lib/stageMirror";
import type { FixtureInstance, Placement } from "@/types/fixture";
import { StageCanvas } from "./StageCanvas";

/** Coloca las luces como van a estar en el evento y mira cómo se ve. */
export function StageView() {
  const store = useFixtureStore();
  const { instances, definitions, updateInstance, moments, effects, getChannelValue, setChannelValues } = store;
  const [aiming, setAiming] = useState(false);
  const preview = usePreview();
  // En vista previa todo va al motor de mentira; si no, a las luces.
  const send = (message: EngineMessage) => (preview.show ? preview.show.send(message) : store.engine.send(message));
  const playback = preview.show?.playback ?? store;
  const [windowError, setWindowError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const defaults = useMemo(() => defaultPlacements(instances, definitions), [instances, definitions]);
  const placementOf = (i: FixtureInstance) => i.placement ?? defaults.get(i.id);

  function place(i: FixtureInstance, patch: Partial<Placement>) {
    const placement = placementOf(i);
    if (placement) updateInstance({ ...i, placement: { ...placement, ...patch } });
  }

  const selected = instances.find((i) => i.id === selectedId);
  const definitionOf = (i: FixtureInstance) => definitions.find((d) => d.id === i.definitionId);
  const heads = instances.filter((i) => {
    const d = definitionOf(i);
    return d && isHead(d);
  });
  // La elegida si es una cabeza; si no, todas.
  const aimed = selected && heads.includes(selected) ? [selected] : heads;

  function aimAll(point: Vec3) {
    const values: ChannelValues = {};
    for (const instance of aimed) {
      const definition = definitionOf(instance)!;
      const placement = placementOf(instance);
      if (!placement) continue;
      const read = (axis: "PAN" | "TILT") =>
        readAxis(definition, axis, (c) => getChannelValue(instance.id, c.id, c.defaultValue));
      const to = aimAt(placement, definition, point, { pan: read("PAN"), tilt: read("TILT") });
      if (to) values[instance.id] = { ...writeAxis(definition, "PAN", to.pan), ...writeAxis(definition, "TILT", to.tilt) };
    }
    if (preview.show) preview.show.send({ type: "values", values });
    else setChannelValues(values);
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <PreviewBar preview={preview} />
        <div
          className={cn(
            "min-h-0 flex-1 rounded-panel border bg-panel p-2",
            preview.show ? "border-accent" : "border-border",
          )}
        >
          <StageCanvas
            rig={preview.show?.rig ?? store}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAim={aiming ? aimAll : undefined}
            onMove={(id, position) => {
              const moved = instances.find((i) => i.id === id);
              if (moved) place(moved, position);
            }}
          />
        </div>
        {moments.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 rounded-panel border border-border bg-panel p-2">
            {moments.map((m) => (
              <Button
                key={m.id}
                selected={m.id === playback.activeMomentId}
                onClick={() => send({ type: "startMoment", id: m.id })}
              >
                {m.name}
              </Button>
            ))}
          </div>
        ) : null}
        <HeldColors
          heldColors={playback.heldColors}
          onPick={(groupId, color) => send({ type: "action", action: { do: "color", groupId, color }, press: true })}
        />
        {effects.some((fx) => fx.groupId) ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-panel border border-border bg-panel p-2">
            <span className="mr-1 text-xs font-medium tracking-wide text-text-secondary">EFECTOS</span>
            {effects
              .filter((fx) => fx.groupId)
              .map((fx) => {
                const running = playback.runningEffectIds.includes(fx.id);
                return (
                  <Button
                    key={fx.id}
                    size="sm"
                    variant={running ? "primary" : "secondary"}
                    aria-pressed={running}
                    onClick={() => send({ type: running ? "stopEffect" : "startEffect", id: fx.id })}
                  >
                    {fx.name}
                  </Button>
                );
              })}
          </div>
        ) : null}
        <div className="flex shrink-0 items-center gap-3">
          <p className="flex-1 text-[11px] text-text-secondary">
            Arrastra una luz para moverla y el fondo para girar la vista. Rueda: acercar. Doble clic: vista inicial.
          </p>
          <Button
            size="sm"
            variant={aiming ? "primary" : "secondary"}
            aria-pressed={aiming}
            disabled={heads.length === 0}
            title="Toca o arrastra sobre el piso: las cabezas apuntan ahí. Si hay una elegida, solo esa."
            onClick={() => setAiming(!aiming)}
          >
            {aiming ? `Apuntando ${aimed.length === 1 ? aimed[0].label : "todas las cabezas"}` : "Apuntar"}
          </Button>
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
          <Button
            size="sm"
            variant="ghost"
            className="mt-3 w-full text-text-secondary"
            onClick={() =>
              askConfirm(
                "¿Restablecer el escenario? Todas las luces vuelven a su lugar inicial y se quita lo de invertir pan y tilt.",
                "Restablecer",
                () => {
                  for (const i of instances) updateInstance({ ...i, placement: undefined, panInvert: false, tiltInvert: false });
                },
              )
            }
          >
            Restablecer posiciones
          </Button>
        </Panel>
      </div>
    </div>
  );
}

type Preview = ReturnType<typeof usePreview>;

/** La vista previa: abrirla, cerrarla y mandar lo probado a las luces. */
function usePreview() {
  const store = useFixtureStore();
  const [show, setShow] = useState<PreviewShow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const { instances, definitions, scenes, palettes, groups, chases, effects, moments } = store;

  useEffect(() => () => show?.stop(), [show]);
  useEffect(() => {
    show?.setDoc(engineDoc(store));
    // Solo cuando cambia lo programado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, instances, definitions, scenes, palettes, groups, chases, effects, moments]);

  return {
    show,
    error,
    open: () => {
      setError(null);
      PreviewShow.start({ doc: engineDoc(store), liveValues: store.liveValues, playback: store }, redraw)
        .then(setShow)
        .catch((e) => setError(String(e)));
    },
    close: () => setShow(null),
    /** Lo probado, en el mismo orden, al show de verdad. */
    apply: () => {
      for (const message of show?.tried ?? []) store.engine.send(message);
      setShow(null);
    },
  };
}

function PreviewBar({ preview }: { preview: Preview }) {
  if (!preview.show) {
    return (
      <div className="flex shrink-0 items-center gap-3">
        <Button size="sm" onClick={preview.open} title="Prueba momentos, colores y efectos solo en la pantalla">
          Vista previa
        </Button>
        <p className="text-[11px] text-text-secondary">
          {preview.error ?? "Prueba aquí sin que cambien las luces, y si te gusta, mándalo."}
        </p>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 rounded-panel border border-accent bg-accent/15 px-3 py-2"
    >
      <span className="text-xs font-semibold tracking-wide text-accent">VISTA PREVIA</span>
      <span className="flex-1 text-xs text-text-primary">Las luces no cambian: solo lo ves aquí.</span>
      <Button size="sm" variant="primary" disabled={preview.show.tried.length === 0} onClick={preview.apply}>
        Mandar a las luces
      </Button>
      <Button size="sm" onClick={preview.close}>
        Salir
      </Button>
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
