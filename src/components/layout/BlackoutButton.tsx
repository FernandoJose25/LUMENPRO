import { useState } from "react";
import { cn } from "@/lib/utils";

interface BlackoutButtonProps {
  active: boolean;
  onBlackout: () => void;
  onRelease: () => void;
}

/**
 * Sección 34 prohíbe expresamente "esconder Blackout dentro de un menú".
 * Vive en la topbar, fuera de cualquier panel, y pide confirmación de un
 * solo gesto (mantener) para evitar el disparo accidental durante un show
 * sin frenar la respuesta cuando es intencional (sección 21). Volver a
 * encender es un solo clic: ahí no hay nada que proteger.
 */
export function BlackoutButton({ active, onBlackout, onRelease }: BlackoutButtonProps) {
  const [armed, setArmed] = useState(false);

  if (active) {
    return (
      <button
        type="button"
        onClick={onRelease}
        className="h-9 shrink-0 animate-pulse rounded-control bg-state-danger px-4 text-sm font-semibold tracking-wide text-white"
        title="Todo apagado — clic para volver a encender"
      >
        VOLVER A ENCENDER
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (armed) {
          onBlackout();
          setArmed(false);
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 1500);
        }
      }}
      className={cn(
        "h-9 shrink-0 rounded-control px-4 text-sm font-semibold tracking-wide transition-colors",
        armed
          ? "bg-state-danger text-white"
          : "bg-state-danger/15 text-state-danger hover:bg-state-danger/25",
      )}
      title={armed ? "Confirmar Blackout" : "Blackout — un clic más para confirmar"}
    >
      {armed ? "CONFIRMAR" : "BLACKOUT"}
    </button>
  );
}
