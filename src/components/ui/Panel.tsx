import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  dense?: boolean;
}

/** Contenedor base para todos los paneles del workspace (sección 2). */
export function Panel({ title, dense, className, children, ...props }: PanelProps) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-panel border border-border bg-panel",
        className,
      )}
      {...props}
    >
      {title ? (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium tracking-wide text-text-secondary">
            {title}
          </span>
        </div>
      ) : null}
      <div className={cn("flex-1 overflow-auto scrollbar-thin", dense ? "p-2" : "p-3")}>
        {children}
      </div>
    </div>
  );
}
