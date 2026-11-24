import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import type { EngineStatus } from "@/lib/dmxOutput";
import { BlackoutButton } from "./BlackoutButton";

interface TopbarProps {
  showName: string;
  dmx: EngineStatus;
  universe: number;
  bpm: number;
  cpu: number;
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

/** Barra superior — sección 4: show, conexión DMX, universe, BPM, CPU/FPS, undo/redo/save, Blackout. */
export function Topbar({
  showName,
  dmx,
  universe,
  bpm,
  cpu,
  onSave,
  blackoutActive,
  onBlackout,
  onReleaseBlackout,
}: TopbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-3">
      <span className="text-sm font-semibold tracking-wide text-text-primary">LUMEN PRO</span>
      <div className="h-5 w-px bg-border" />

      <span className="text-sm text-text-secondary">
        Show: <span className="text-text-primary">{showName}</span>
      </span>

      <div className="ml-2 flex items-center gap-4">
        <StatusIndicator label="USB-DMX" {...DMX_INDICATOR[dmx.state]} />
        <StatusIndicator status="active" label={`Universe ${universe}`} />
        <span className="font-mono text-xs text-text-secondary">{bpm} BPM</span>
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-3 font-mono text-xs text-text-secondary md:flex">
        <span>CPU {cpu}%</span>
        <span>FPS {dmx.fps}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" aria-label="Deshacer">
          Undo
        </Button>
        <Button variant="ghost" size="sm" aria-label="Rehacer">
          Redo
        </Button>
        <SaveButton onSave={onSave} />
      </div>

      <div className="h-5 w-px bg-border" />
      <BlackoutButton active={blackoutActive} onBlackout={onBlackout} onRelease={onReleaseBlackout} />
    </header>
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
