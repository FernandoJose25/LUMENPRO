import { useState } from "react";
import { cn } from "@/lib/utils";

interface BlackoutButtonProps {
  onBlackout: () => void;
}

/**
 * Sección 34 prohíbe expresamente "esconder Blackout dentro de un menú".
 * Vive en la topbar, fuera de cualquier panel, y pide confirmación de un
 * solo gesto (mantener) para evitar el disparo accidental durante un show
 * sin frenar la respuesta cuando es intencional (sección 21).
 */
export function BlackoutButton({ onBlackout }: BlackoutButtonProps) {
  const [armed, setArmed] = useState(false);

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
