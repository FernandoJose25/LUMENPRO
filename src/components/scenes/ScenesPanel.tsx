import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";

/**
 * Fase 4 — primer ítem de PASOS-PENDIENTES.md: "Lógica real detrás de los
 * botones de escenas (hoy son placeholders)". Ya no lo son: cada escena
 * guarda una foto de `liveValues` (fixtureStore) y recuperarla escribe esos
 * valores de vuelta. Lo que sigue faltando de Fase 4: Chases (secuencias de
 * escenas con tiempos), Effects (generadores paramétricos) y Groups como
 * entidad de primera clase (hoy `FixtureInstance.group` existe en el tipo
 * pero nada en la UI lo usa todavía).
 */
export function ScenesPanel() {
  const { scenes, activeSceneId, saveScene, updateSceneValues, renameScene, removeScene, recallScene, liveValues } =
    useFixtureStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const touchedInstanceCount = Object.values(liveValues).filter((ch) => Object.keys(ch).length > 0).length;

  function handleSaveNew() {
    const name = window.prompt("Nombre de la nueva escena:", `Escena ${scenes.length + 1}`);
    if (name === null) return; // cancelado
    saveScene(name);
  }

  function startRename(sceneId: string, currentName: string) {
    setRenamingId(sceneId);
    setDraftName(currentName);
  }

  function commitRename(sceneId: string) {
    renameScene(sceneId, draftName);
    setRenamingId(null);
  }

  function handleDelete(sceneId: string, name: string) {
    if (window.confirm(`¿Borrar la escena "${name}"? Esto no se puede deshacer.`)) {
      removeScene(sceneId);
    }
  }

  return (
    <Panel title="ESCENAS" className="h-full">
      {touchedInstanceCount === 0 && scenes.length === 0 ? (
        <p className="mb-3 text-[11px] text-text-secondary">
          Mueve algún canal en FIXTURE CONTROL y luego guarda una escena — todavía no hay
          nada capturado.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {scenes.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const isRenaming = renamingId === scene.id;

          if (isRenaming) {
            return (
              <input
                key={scene.id}
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => commitRename(scene.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename(scene.id);
                  if (e.key === "Escape") setRenamingId(null);
                }}
                className="h-12 w-32 rounded-control border border-accent bg-panel2 px-3 text-sm text-text-primary outline-none"
              />
            );
          }

          return (
            <div key={scene.id} className="group relative">
              <Button
                size="lg"
                variant="secondary"
                selected={isActive}
                onClick={() => recallScene(scene.id)}
                onDoubleClick={() => startRename(scene.id, scene.name)}
                className={cn(isActive && "bg-accent/15 text-accent")}
                title="Clic: recuperar · Doble clic: renombrar"
              >
                {scene.name}
              </Button>
              <div className="absolute -right-1.5 -top-1.5 hidden gap-1 group-hover:flex">
                <button
                  type="button"
                  title="Re-grabar con los valores actuales"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateSceneValues(scene.id);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-panel2 text-[10px] text-text-secondary ring-1 ring-border hover:text-accent"
                >
                  ⟳
                </button>
                <button
                  type="button"
                  title="Borrar escena"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(scene.id, scene.name);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-panel2 text-[10px] text-text-secondary ring-1 ring-border hover:text-state-danger"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}

        <Button size="lg" variant="primary" onClick={handleSaveNew}>
          + Guardar escena
        </Button>
      </div>

      <p className="mt-3 text-[11px] text-text-secondary">
        Clic: recuperar (aplica los canales guardados, sin tocar el resto del rig) · ⟳: re-grabar
        con los valores actuales · doble clic: renombrar. Chases/Effects/Groups siguen
        pendientes — ver PASOS-PENDIENTES.md.
      </p>
    </Panel>
  );
}
