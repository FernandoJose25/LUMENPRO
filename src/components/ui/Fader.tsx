import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface FaderProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  error?: string;
  onChange: (value: number) => void;
}

/**
 * Control dual: barra arrastrable + entrada numérica exacta, tal como pide
 * la sección 27 ("Además del slider, debe existir entrada numérica para
 * valores exactos") y soporta click, drag, wheel y teclado.
 */
export function Fader({
  label,
  value,
  min = 0,
  max = 255,
  step = 1,
  unit,
  disabled,
  error,
  onChange,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      const raw = min + ratio * (max - min);
      onChange(clamp(Math.round(raw / step) * step));
    },
    [clamp, max, min, onChange, step],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    setFromClientX(e.clientX);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setFromClientX(e.clientX);
  };
  const handlePointerUp = () => setDragging(false);

  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    onChange(clamp(value + (e.deltaY < 0 ? step : -step)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(clamp(value + step));
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(clamp(value - step));
    if (e.key === "Home") onChange(min);
    if (e.key === "End") onChange(max);
  };

  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-40")}>
      <span className="w-16 shrink-0 text-xs font-medium text-text-secondary">{label}</span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        aria-invalid={Boolean(error)}
        className={cn(
          "relative h-2 flex-1 cursor-pointer rounded-full bg-panel2",
          !disabled && "hover:bg-panel2/70",
          error && "outline outline-1 outline-state-danger",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", error ? "bg-state-danger" : "bg-accent")}
          style={{ width: `${pct}%` }}
        />
        <div
          className={cn(
            "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-bg",
            error ? "bg-state-danger" : "bg-accent",
            dragging && "scale-125",
            "transition-transform",
          )}
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex w-16 shrink-0 items-center rounded-control border border-border bg-panel2">
        <button
          type="button"
          disabled={disabled}
          className="px-1.5 py-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
          onClick={() => onChange(clamp(value - step))}
          aria-label={`Disminuir ${label}`}
        >
          −
        </button>
        <input
          type="number"
          value={value}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          className="w-full min-w-0 bg-transparent text-center font-mono text-xs text-text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={disabled}
          className="px-1.5 py-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
          onClick={() => onChange(clamp(value + step))}
          aria-label={`Aumentar ${label}`}
        >
          +
        </button>
      </div>
      {unit ? <span className="w-6 shrink-0 text-xs text-text-secondary">{unit}</span> : null}
      {error ? <span className="text-xs text-state-danger">{error}</span> : null}
    </div>
  );
}
