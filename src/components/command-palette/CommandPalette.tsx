import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";

interface Command {
  id: string;
  label: string;
  group: "Navegar" | "Escenas" | "Effects" | "Acciones";
  action: () => void;
}

interface CommandPaletteProps {
  sections: readonly string[];
  activeSection: string;
  onSelectSection: (section: string) => void;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

/**
 * Command Palette / atajos globales (pendiente del roadmap — ver
 * LUMENPRO-que-sigue.md). Ctrl/Cmd+K abre desde cualquier pantalla; Esc
 * cierra; ↑/↓ mueve la selección; Enter ejecuta el comando resaltado.
 *
 * Deliberadamente NO incluye "reproducir chase X" como comando global:
 * a diferencia de Effects (motor único montado en App.tsx — ver
 * lib/effectEngine.ts), Chases se reproduce con un `useChasePlayer` local
 * a la vista que lo abre (ChasesView o LiveView), así que no hay un chase
 * "actualmente en reproducción" que este componente pueda controlar desde
 * fuera de esas dos pantallas. El comando de navegación ("Ir a Chases")
 * sigue disponible — llegar ahí y reproducir queda a un clic más.
 */
export function CommandPalette({ sections, activeSection, onSelectSection }: CommandPaletteProps) {
  const { scenes, recallScene, effects, runningEffectIds, startEffect, stopEffect, blackout } =
    useFixtureStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  };

  // Atajo global: funciona parado en cualquier sección, no solo cuando la
  // paleta ya está abierta — por eso el listener vive en window, no en un
  // elemento del propio componente.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    for (const section of sections) {
      if (section === activeSection) continue;
      list.push({
        id: `nav-${section}`,
        label: `Ir a ${section}`,
        group: "Navegar",
        action: () => onSelectSection(section),
      });
    }

    for (const scene of scenes) {
      list.push({
        id: `scene-${scene.id}`,
        label: `Recuperar escena "${scene.name}"`,
        group: "Escenas",
        action: () => recallScene(scene.id),
      });
    }

    for (const fx of effects) {
      const isRunning = runningEffectIds.includes(fx.id);
      // Sin grupo objetivo, "Reproducir" no haría nada (mismo guard que
      // el botón de EffectsView) — no listar ese comando en ese caso.
      if (!fx.groupId && !isRunning) continue;
      list.push({
        id: `effect-${fx.id}`,
        label: isRunning ? `Detener effect "${fx.name}"` : `Reproducir effect "${fx.name}"`,
        group: "Effects",
        action: () => (isRunning ? stopEffect(fx.id) : startEffect(fx.id)),
      });
    }

    list.push({
      id: "blackout",
      label: "BLACKOUT — apagar todo el rig",
      group: "Acciones",
      action: blackout,
    });

    return list;
  }, [sections, activeSection, onSelectSection, scenes, recallScene, effects, runningEffectIds, startEffect, stopEffect, blackout]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  // Si el filtro cambia y deja el índice resaltado fuera de rango, volver
  // al primer resultado en vez de quedar apuntando a "nada".
  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered, highlighted]);

  function run(command: Command) {
    command.action();
    close();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 rounded-full border border-border bg-panel px-3 py-1.5 font-mono text-[11px] text-text-secondary shadow-lg hover:text-text-primary"
        title="Abrir Command Palette"
      >
        {isMac ? "⌘K" : "Ctrl+K"} Comandos
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={close}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-panel border border-border bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command Palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlighted((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlighted((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const command = filtered[highlighted];
              if (command) run(command);
            }
          }}
          placeholder="Ir a una sección, recuperar una escena, disparar un effect…"
          className="h-12 w-full rounded-t-panel border-b border-border bg-transparent px-4 text-sm text-text-primary outline-none placeholder:text-text-secondary"
        />
        <div className="max-h-80 overflow-y-auto scrollbar-thin p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-secondary">Sin resultados.</p>
          ) : (
            filtered.map((command, index) => (
              <button
                key={command.id}
                type="button"
                onClick={() => run(command)}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-sm",
                  index === highlighted
                    ? "bg-accent/15 text-accent"
                    : "text-text-primary hover:bg-panel2",
                )}
              >
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">
                  {command.group}
                </span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
