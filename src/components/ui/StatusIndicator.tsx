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

const pulseClass: Record<Status, string> = {
  idle: "",
  ok: "",
  active: "animate-pulse",
  warn: "animate-pulse",
  danger: "animate-pulse",
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
