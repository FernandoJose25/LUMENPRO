import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";
import { useUpdate } from "@/lib/updates";
import { UpdateModal } from "./UpdateModal";
import type { EngineStatus } from "@/types/engine";
import { BlackoutButton } from "./BlackoutButton";

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
        {bpm !== null ? <span className="font-mono text-xs text-text-secondary">{bpm} BPM</span> : null}
      </div>

      <div className="flex-1" />

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
        title="Deshacer lo último programado (Ctrl+Z). No cambia los faders."
        disabled={!canUndo}
        onClick={undo}
      >
        Undo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Rehacer"
        title="Rehacer (Ctrl+Y)"
        disabled={!canRedo}
        onClick={redo}
      >
        Redo
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
    <Button variant={result === "Error al guardar" ? "danger" : "secondary"} size="sm" onClick={handleClick}>
      {result ?? "Save"}
    </Button>
  );
}
