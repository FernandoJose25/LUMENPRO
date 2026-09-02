import { Panel } from "@/components/ui/Panel";

interface PlaceholderViewProps {
  section: string;
  phase: string;
}

/**
 * En vez de silenciosamente mostrar el Dashboard para cualquier sección
 * del Sidebar (bug real que tenía Fase 2), cada sección no implementada
 * dice explícitamente en qué fase le toca — ver AUDIT.md.
 */
export function PlaceholderView({ section, phase }: PlaceholderViewProps) {
  return (
    <div className="flex h-full items-center justify-center p-4">
      <Panel className="max-w-md text-center">
        <div className="mb-1 text-sm font-medium text-text-primary">{section}</div>
        <p className="text-xs text-text-secondary">
          Pendiente — corresponde a <span className="text-text-primary">{phase}</span> del plan
          de fases. Ver <code className="text-accent">AUDIT.md</code> para el detalle de qué
          falta y por qué.
        </p>
      </Panel>
    </div>
  );
}
