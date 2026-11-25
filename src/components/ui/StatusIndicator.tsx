import { cn } from "@/lib/utils";

type Status = "idle" | "ok" | "active" | "warn" | "danger";

interface StatusIndicatorProps {
  status: Status;
  label: string;
  detail?: string;
  className?: string;
}

// Sección 19: gris=inactivo, verde=conectado/OK, accent=seleccionado/activo,
// amarillo=advertencia, rojo=error/blackout.
// Sección 21: "los controles no deben depender únicamente del color" —
// por eso cada estado también trae texto, nunca solo el punto de color.
const dotClass: Record<Status, string> = {
  idle: "bg-state-idle",
  ok: "bg-state-ok",
  active: "bg-accent",
  warn: "bg-state-warn",
  danger: "bg-state-danger",
};

// Solo lo pasajero (reconectando) late. Una animación que nunca para obliga a
// redibujar a la frecuencia de la pantalla: con un punto fijo latiendo, la app
// quieta gastaba un tercio de núcleo a 240 Hz.
const pulseClass: Record<Status, string> = {
  idle: "",
  ok: "",
  active: "",
  warn: "animate-pulse",
  danger: "",
};

export function StatusIndicator({ status, label, detail, className }: StatusIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2 text-xs", className)}>
      <span
        className={cn("h-2 w-2 rounded-full", dotClass[status], pulseClass[status])}
        aria-hidden
      />
      <span className="font-medium text-text-primary">{label}</span>
      {detail ? <span className="text-text-secondary">{detail}</span> : null}
    </div>
  );
}
