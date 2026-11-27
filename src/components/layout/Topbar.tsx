import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";
import { useUpdate } from "@/lib/updates";
import { UpdateModal } from "./UpdateModal";
import type { EngineStatus } from "@/types/engine";
import { BlackoutButton } from "./BlackoutButton";
import { cn } from "@/lib/utils";

interface TopbarProps {
  dmx: EngineStatus;
  /** De la música que se está escuchando; null si no hay. */
  bpm: number | null;
  onSave: () => Promise<void>;
  blackoutActive: boolean;
  onBlackout: () => void;
  onReleaseBlackout: () => void;
}

const DMX_INDICATOR = {
  stopped: { status: "danger", detail: "Desconectado" },
  running: { status: "ok", detail: "Conectado" },
  reconnecting: { status: "warn", detail: "Reconectando…" },
} as const;

/** Barra superior — sección 4: conexión DMX, universe, BPM, FPS, undo/redo/save, Blackout. */
export function Topbar({
  dmx,
  bpm,
  onSave,
  blackoutActive,
  onBlackout,
  onReleaseBlackout,
}: TopbarProps) {
  const universes = [...new Set(dmx.outputs.map((o) => o.config.universe))].sort((a, b) => a - b);
  // Con varias salidas, la más lenta.
  const fps = dmx.outputs.length > 0 ? Math.min(...dmx.outputs.map((o) => o.fps)) : 0;
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-3">
      <span className="text-sm font-semibold tracking-wide text-text-primary">LUMEN PRO</span>
      <div className="h-5 w-px bg-border" />

      <div className="flex items-center gap-4">
        <StatusIndicator label="DMX" {...DMX_INDICATOR[dmx.state]} />
        {universes.length > 0 ? (
          <StatusIndicator
            status="active"
            label={`${universes.length === 1 ? "Universo" : "Universos"} ${universes.join(", ")}`}
          />
        ) : null}
        <TapButton heard={bpm} />
      </div>

      <div className="flex-1" />

      <MovingNow />

      <NewVersion lightsOn={dmx.state === "running"} />

      <span className="hidden font-mono text-xs text-text-secondary md:inline">FPS {fps}</span>

      <div className="flex items-center gap-1.5">
        <UndoButtons />
        <SaveButton onSave={onSave} />
      </div>

      <div className="h-5 w-px bg-border" />
      <BlackoutButton active={blackoutActive} onBlackout={onBlackout} onRelease={onReleaseBlackout} />
    </header>
  );
}

/**
 * Tap: se toca al ritmo de la canción (también con la tecla T) y lo que sigue
 * la música va con ese tempo, sin micrófono. Al lado, el ritmo que manda.
 */
function TapButton({ heard }: { heard: number | null }) {
  const { tapBpm, djBpm, tap, clearTap } = useFixtureStore();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== "t") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      e.preventDefault();
      tap();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tap]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Tap: marcar el ritmo"
        title="Toca al ritmo de la canción, un toque por golpe (o la tecla T). Lo que sigue la música va con este ritmo."
        // Al apretar, no al soltar: cada toque tiene que caer en el golpe.
        onPointerDown={(e) => {
          e.preventDefault();
          tap();
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          tap();
        }}
        className={cn(
          "h-7 select-none rounded-control border px-2.5 text-xs font-semibold tracking-wide active:scale-95",
          tapBpm !== null ? "border-accent bg-accent/20 text-accent" : "border-border bg-panel2 text-text-primary hover:bg-panel2/70",
        )}
      >
        TAP
      </button>
      {tapBpm !== null ? (
        <>
          <span className="font-mono text-xs text-accent">{Math.round(tapBpm)} BPM a mano</span>
          <button
            type="button"
            aria-label="Soltar el ritmo"
            title="Volver a seguir lo que se escucha"
            onClick={clearTap}
            className="h-6 w-6 rounded-control text-text-secondary hover:bg-panel2 hover:text-text-primary"
          >
            ×
          </button>
        </>
      ) : djBpm !== null ? (
        <span className="font-mono text-xs text-text-secondary">{Math.round(djBpm)} BPM · VirtualDJ</span>
      ) : heard !== null ? (
        <span className="font-mono text-xs text-text-secondary">{heard} BPM</span>
      ) : null}
    </div>
  );
}

/**
 * Lo que se está moviendo solo (effects y chase), esté donde esté el
 * usuario: un fader que sube y baja sin razón a la vista es un effect que
 * quedó prendido, por ejemplo el de un momento. "Detener" lo para todo y
 * deja las luces como están.
 */
function MovingNow() {
  const { effects, runningEffectIds, chases, chase, moments, activeMomentId, stopMoment } = useFixtureStore();
  const running = effects.filter((fx) => runningEffectIds.includes(fx.id));
  const chaseName = chase ? chases.find((c) => c.id === chase.id)?.name : undefined;
  const names = [...running.map((fx) => fx.name), ...(chaseName ? [`chase ${chaseName}`] : [])];
  if (names.length === 0) return null;
  const moment = moments.find((m) => m.id === activeMomentId);
  const fromMoment = moment && running.some((fx) => moment.effectIds.includes(fx.id)) ? ` · del momento «${moment.name}»` : "";
  const text = names.length === 1 ? names[0] : `${names.length} efectos`;
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`Corriendo: ${names.join(", ")}${fromMoment}`}>
      <span className="truncate text-xs text-accent">
        ▶ {text}
        <span className="text-text-secondary">{fromMoment}</span>
      </span>
      <Button size="sm" variant="ghost" title="Detiene efectos y chase; las luces quedan como están" onClick={stopMoment}>
        ■ Detener
      </Button>
    </div>
  );
}

/** Aviso al abrir; si se deja para después, queda este botón. */
function NewVersion({ lightsOn }: { lightsOn: boolean }) {
  const update = useUpdate();
  if (!update.version) return null;
  return (
    <>
      <Button size="sm" variant="primary" onClick={update.show}>
        Versión nueva: {update.version}
      </Button>
      <UpdateModal update={update} lightsOn={lightsOn} />
    </>
  );
}

function UndoButtons() {
  const { canUndo, canRedo, undo, redo } = useFixtureStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isRedo = key === "y" || (key === "z" && e.shiftKey);
      if (key !== "z" && !isRedo) return;
      // Dentro de un campo de texto, Ctrl+Z deshace lo escrito.
      const target = e.target;
      if (target instanceof HTMLTextAreaElement) return;
      if (target instanceof HTMLInputElement && !["range", "checkbox", "color"].includes(target.type)) return;
      e.preventDefault();
      if (isRedo) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Deshacer"
        title="Vuelve atrás lo último que programaste: un efecto, una escena, un momento (Ctrl+Z). No mueve los faders ni apaga lo que está prendido."
        disabled={!canUndo}
        onClick={undo}
      >
        ↶ Deshacer
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Rehacer"
        title="Vuelve a poner lo que deshiciste (Ctrl+Y)"
        disabled={!canRedo}
        onClick={redo}
      >
        ↷ Rehacer
      </Button>
    </>
  );
}

function SaveButton({ onSave }: { onSave: () => Promise<void> }) {
  const [result, setResult] = useState<"Guardado" | "Error al guardar" | null>(null);

  const handleClick = async () => {
    try {
      await onSave();
      setResult("Guardado");
    } catch {
      setResult("Error al guardar");
    }
    window.setTimeout(() => setResult(null), 2000);
  };

  return (
    <Button
      variant={result === "Error al guardar" ? "danger" : "secondary"}
      size="sm"
      title="Se guarda solo; esto lo guarda ya mismo"
      onClick={handleClick}
    >
      {result ?? "Guardar"}
    </Button>
  );
}
