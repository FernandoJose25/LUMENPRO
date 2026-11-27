import { useEffect, useReducer, useState } from "react";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { Button } from "@/components/ui/Button";
import { engineDoc, useFixtureStore } from "@/lib/fixtureStore";
import { lookValues } from "@/lib/look";
import { PreviewShow } from "@/lib/preview";
import type { Effect } from "@/types/effect";

/**
 * Effects corriendo en un motor aparte, solo en la pantalla: las luces de
 * verdad no cambian. El grupo se enciende para que se vea, salvo que el
 * effect mueva el dimmer él mismo. Arranca una vez: para otro effect, otra key.
 */
export function EffectPreview({ effects }: { effects: Effect[] }) {
  const store = useFixtureStore();
  const [show, setShow] = useState<PreviewShow | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    let started: PreviewShow | null = null;
    const ids = new Set(effects.map((fx) => fx.id));
    const doc = { ...engineDoc(store), effects: [...store.effects.filter((fx) => !ids.has(fx.id)), ...effects] };
    const groups = new Set(effects.map((fx) => fx.groupId));
    const members = store.instances.filter((i) => groups.has(i.group ?? null));
    const ownDimmer = effects.some((fx) => fx.kind === "wave" && fx.channelType === "DIMMER");
    const lit = ownDimmer ? {} : lookValues(members, store.definitions, { DIMMER: 255 });
    PreviewShow.start(
      { doc, liveValues: { ...store.liveValues, ...lit }, playback: { ...store, runningEffectIds: [], heldColors: {} } },
      redraw,
    )
      .then((s) => {
        started = s;
        if (!alive) return s.stop();
        for (const fx of effects) s.send({ type: "startEffect", id: fx.id });
        setShow(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
      started?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return show ? <StageCanvas rig={show.rig} /> : null;
}

/** Una ventana para mirar un effect antes de prenderlo en las luces. */
export function EffectPreviewDialog({
  effect,
  onClose,
  onStart,
}: {
  effect: Effect;
  onClose: () => void;
  /** Con esto, un botón para prenderlo de verdad. */
  onStart?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Vista previa: ${effect.name}`}
        className="flex h-[80vh] w-full max-w-4xl flex-col gap-3 rounded-panel border border-accent bg-panel p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-accent">VISTA PREVIA</span>
          <span className="flex-1 truncate text-sm text-text-primary">{effect.name}</span>
          <span className="text-[11px] text-text-secondary">Las luces no cambian: solo lo ves aquí.</span>
        </div>
        <div className="min-h-0 flex-1 rounded-panel border border-border bg-panel2 p-2">
          <EffectPreview key={JSON.stringify(effect)} effects={[effect]} />
        </div>
        <div className="flex justify-end gap-2">
          {onStart ? (
            <Button
              variant="primary"
              onClick={() => {
                onStart();
                onClose();
              }}
            >
              ▶ Prender en las luces
            </Button>
          ) : null}
          <Button autoFocus onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
