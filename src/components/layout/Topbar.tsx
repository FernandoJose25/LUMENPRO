import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { BlackoutButton } from "./BlackoutButton";

interface TopbarProps {
  showName: string;
  dmxConnected: boolean;
  universe: number;
  bpm: number;
  cpu: number;
  fps: number;
  onBlackout: () => void;
}

/** Barra superior — sección 4: show, conexión DMX, universe, BPM, CPU/FPS, undo/redo/save, Blackout. */
export function Topbar({ showName, dmxConnected, universe, bpm, cpu, fps, onBlackout }: TopbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border bg-panel px-3">
      <span className="text-sm font-semibold tracking-wide text-text-primary">LUMEN PRO</span>
      <div className="h-5 w-px bg-border" />

      <span className="text-sm text-text-secondary">
        Show: <span className="text-text-primary">{showName}</span>
      </span>

      <div className="ml-2 flex items-center gap-4">
        <StatusIndicator
          status={dmxConnected ? "ok" : "danger"}
          label="USB-DMX"
          detail={dmxConnected ? "Conectado" : "Desconectado"}
        />
        <StatusIndicator status="active" label={`Universe ${universe}`} />
        <span className="font-mono text-xs text-text-secondary">{bpm} BPM</span>
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-3 font-mono text-xs text-text-secondary md:flex">
        <span>CPU {cpu}%</span>
        <span>FPS {fps}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="sm" aria-label="Deshacer">
          Undo
        </Button>
        <Button variant="ghost" size="sm" aria-label="Rehacer">
          Redo
        </Button>
        <Button variant="secondary" size="sm">
          Save
        </Button>
      </div>

      <div className="h-5 w-px bg-border" />
      <BlackoutButton onBlackout={onBlackout} />
    </header>
  );
}
