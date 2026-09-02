import { useState } from "react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  "Dashboard",
  "Fixtures",
  "Groups",
  "Scenes",
  "Chases",
  "Effects",
  "Timeline",
  "Audio Reactive",
  "Universes",
  "DMX Output",
  "Settings",
] as const;

interface SidebarProps {
  active: string;
  onSelect: (section: string) => void;
}

/** Sección 3 — navegación fija, icono+texto, colapsable a solo iconos. */
export function Sidebar({ active, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col border-r border-border bg-panel transition-[width] duration-150",
        collapsed ? "w-14" : "w-48",
      )}
    >
      <div className="flex-1 overflow-y-auto scrollbar-thin py-2">
        {SECTIONS.map((section) => {
          const isActive = section === active;
          return (
            <button
              key={section}
              type="button"
              onClick={() => onSelect(section)}
              title={collapsed ? section : undefined}
              className={cn(
                "relative flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors",
                isActive
                  ? "text-text-primary"
                  : "text-text-secondary hover:bg-panel2 hover:text-text-primary",
              )}
            >
              {isActive ? (
                <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-accent" aria-hidden />
              ) : null}
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  isActive ? "bg-accent" : "bg-text-secondary/40",
                )}
                aria-hidden
              />
              {!collapsed ? <span className="truncate">{section}</span> : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="border-t border-border px-3.5 py-2.5 text-left text-xs text-text-secondary hover:bg-panel2 hover:text-text-primary"
      >
        {collapsed ? "»" : "« Colapsar"}
      </button>
    </nav>
  );
}
