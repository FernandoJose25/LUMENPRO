import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { useChasePlayer } from "@/lib/chasePlayer";

/**
 * Fase 4 — Chases. Un chase es una secuencia de Scenes (ya guardadas en
 * ScenesPanel) con tiempos de fade/hold entre ellas — reutiliza toda la
 * infraestructura de Scenes en vez de duplicar valores de canal (ver
 * comentario en types/chase.ts). Reproducir corre en el navegador
 * (lib/chasePlayer.ts) y anima liveValues del fixtureStore — no hay
 * motor DMX conectado al frontend todavía, así que "reproducir" mueve
 * los faders/valores en pantalla, no sale nada por un cable DMX real.
 */
export function ChasesView() {
  const { chases, scenes, addChase, renameChase, removeChase, setChaseLoop } = useFixtureStore();
  const [selectedChaseId, setSelectedChaseId] = useState<string | null>(chases[0]?.id ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    if (selectedChaseId && !chases.some((c) => c.id === selectedChaseId)) {
      setSelectedChaseId(chases[0]?.id ?? null);
    }
  }, [chases, selectedChaseId]);

  const selectedChase = chases.find((c) => c.id === selectedChaseId) ?? null;
  void selectedChase; // no se usa directamente aquí — ChaseEditor resuelve el chase por id

  function handleCreate() {
    const name = window.prompt("Nombre del chase:", `Chase ${chases.length + 1}`);
    if (name === null) return;
    const created = addChase(name);
    setSelectedChaseId(created.id);
  }

  function startRename(id: string, currentName: string) {
    setRenamingId(id);
    setDraftName(currentName);
  }

  function commitRename(id: string) {
    renameChase(id, draftName);
    setRenamingId(null);
  }

  function handleDelete(id: string, name: string) {
    if (window.confirm(`¿Borrar el chase "${name}"? Esto no borra las escenas que usa.`)) {
      removeChase(id);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-[280px] shrink-0">
        <Panel title="CHASES" className="h-full">
          {scenes.length === 0 ? (
            <p className="mb-3 text-[11px] text-text-secondary">
              No hay escenas guardadas todavía. Un chase reproduce escenas en secuencia — primero
              guarda al menos dos escenas en <span className="text-text-primary">Scenes</span>.
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {chases.map((c) => {
              const isSelected = c.id === selectedChaseId;
              const isRenaming = renamingId === c.id;

              if (isRenaming) {
                return (
                  <input
                    key={c.id}
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-9 rounded-control border border-accent bg-panel2 px-2.5 text-sm text-text-primary outline-none"
                  />
                );
              }

              return (
                <div key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelectedChaseId(c.id)}
                    onDoubleClick={() => startRename(c.id, c.name)}
                    title="Clic: seleccionar · Doble clic: renombrar"
                    className={cn(
                      "flex w-full items-center justify-between rounded-control border px-3 py-2 text-left text-sm",
                      isSelected
                        ? "border-accent bg-accent/15 text-accent"
                        : "border-border bg-panel2 text-text-primary hover:bg-panel2/70",
                    )}
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="text-[10px] text-text-secondary">{c.steps.length} steps</span>
                  </button>
                  <button
                    type="button"
                    title="Borrar chase"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(c.id, c.name);
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-panel2 text-[10px] text-text-secondary ring-1 ring-border hover:text-state-danger group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <Button size="md" variant="primary" className="mt-2 w-full" onClick={handleCreate}>
            + Nuevo chase
          </Button>
        </Panel>
      </div>

      <div className="min-w-0 flex-1">
        <ChaseEditor chaseId={selectedChaseId} onToggleLoop={setChaseLoop} />
      </div>
    </div>
  );
}

function ChaseEditor({
  chaseId,
  onToggleLoop,
}: {
  chaseId: string | null;
  onToggleLoop: (chaseId: string, loop: boolean) => void;
}) {
  const {
    chases,
    scenes,
    getChannelValue,
    setChannelValue,
    addChaseStep,
    removeChaseStep,
    updateChaseStep,
    moveChaseStep,
  } = useFixtureStore();
  const chase = chases.find((c) => c.id === chaseId) ?? null;
  const [addingSceneId, setAddingSceneId] = useState("");

  const { status, play, stop } = useChasePlayer({ chase, scenes, getChannelValue, setChannelValue });

  if (!chase) {
    return (
      <Panel title="CHASE" className="h-full">
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          Selecciona o crea un chase a la izquierda.
        </div>
      </Panel>
    );
  }

  const availableScenes = scenes; // cualquier escena se puede repetir en varios steps

  return (
    <Panel title={`CHASE — ${chase.name}`} className="h-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="md"
          variant={status.playing ? "danger" : "primary"}
          onClick={status.playing ? stop : play}
          disabled={chase.steps.length === 0}
        >
          {status.playing ? "■ Detener" : "▶ Reproducir"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={chase.loop}
            onChange={(e) => onToggleLoop(chase.id, e.target.checked)}
            className="accent-accent"
          />
          Loop
        </label>
        {status.playing ? (
          <span className="font-mono text-[11px] text-text-secondary">
            step {status.stepIndex + 1}/{chase.steps.length} · {status.phase}{" "}
            {Math.round(status.progress * 100)}%
          </span>
        ) : null}
      </div>

      <div className="flex max-h-[calc(100%-8rem)] flex-col gap-1.5 overflow-y-auto scrollbar-thin pr-1">
        {chase.steps.length === 0 ? (
          <p className="text-xs text-text-secondary">
            Este chase no tiene steps todavía. Agrega uno abajo eligiendo una escena guardada.
          </p>
        ) : null}
        {chase.steps.map((step, index) => {
          const scene = scenes.find((s) => s.id === step.sceneId);
          const isCurrent = status.playing && status.stepIndex === index;
          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-xs",
                isCurrent ? "border-accent bg-accent/10" : "border-border bg-panel2",
              )}
            >
              <span className="w-5 shrink-0 font-mono text-text-secondary">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-text-primary">
                {scene?.name ?? "(escena borrada)"}
              </span>
              <label className="flex shrink-0 items-center gap-1 text-text-secondary">
                fade
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={step.fadeMs}
                  onChange={(e) => updateChaseStep(chase.id, step.id, { fadeMs: Number(e.target.value) || 0 })}
                  className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-right font-mono text-[11px] text-text-primary outline-none"
                />
                ms
              </label>
              <label className="flex shrink-0 items-center gap-1 text-text-secondary">
                hold
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={step.holdMs}
                  onChange={(e) => updateChaseStep(chase.id, step.id, { holdMs: Number(e.target.value) || 0 })}
                  className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-right font-mono text-[11px] text-text-primary outline-none"
                />
                ms
              </label>
              <button
                type="button"
                title="Mover arriba"
                disabled={index === 0}
                onClick={() => moveChaseStep(chase.id, step.id, -1)}
                className="text-text-secondary hover:text-text-primary disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                title="Mover abajo"
                disabled={index === chase.steps.length - 1}
                onClick={() => moveChaseStep(chase.id, step.id, 1)}
                className="text-text-secondary hover:text-text-primary disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                title="Quitar step"
                onClick={() => removeChaseStep(chase.id, step.id)}
                className="text-text-secondary hover:text-state-danger"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <select
          value={addingSceneId}
          onChange={(e) => setAddingSceneId(e.target.value)}
          className="h-9 flex-1 rounded-control border border-border bg-panel2 px-2 text-xs text-text-primary outline-none"
        >
          <option value="">Elegir escena para agregar…</option>
          {availableScenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          size="md"
          variant="secondary"
          disabled={!addingSceneId}
          onClick={() => {
            addChaseStep(chase.id, addingSceneId);
            setAddingSceneId("");
          }}
        >
          + Agregar step
        </Button>
      </div>
    </Panel>
  );
}
