import { useEffect, useMemo, useState } from "react";
import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { BlackoutButton } from "@/components/layout/BlackoutButton";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { useChasePlayer } from "@/lib/chasePlayer";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";

/**
 * Live Mode (pendiente del roadmap — ver LUMENPRO-que-sigue.md) — pantalla
 * de OPERACIÓN, no de edición: sin crear/renombrar/borrar, sin ajustar
 * fade/hold de un chase ni parámetros de un effect. Todo lo que hay aquí
 * ya existía como lógica real en fixtureStore/chasePlayer/effectEngine
 * (Fase 4); esta vista solo la expone con controles grandes ("sección 1",
 * ver comentario de tamaños en ui/Button.tsx) pensados para tocarse rápido
 * durante un show, no para configurar con calma.
 *
 * Limitación conocida, igual que en ChasesView: solo hay UN motor de
 * chase activo a la vez (un solo `useChasePlayer` montado aquí). Elegir
 * otro chase mientras uno está sonando no lo detiene automáticamente por
 * sí solo — hay que presionar Detener primero. Esto es consistente con el
 * resto del código, no una limitación nueva de esta vista.
 */
export function LiveView() {
  const { scenes, activeSceneId, recallScene, effects, runningEffectIds, groups, blackout } =
    useFixtureStore();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
      <LiveStatusBar
        hasActiveScene={Boolean(activeSceneId)}
        runningEffectCount={runningEffectIds.length}
        groupCount={groups.length}
        onBlackout={blackout}
      />

      <PanelGroup direction="horizontal" className="min-h-0 flex-1 gap-2">
        <ResizablePanel defaultSize={55} minSize={30}>
          <PanelGroup direction="vertical" className="h-full gap-2">
            <ResizablePanel defaultSize={50} minSize={20}>
              <LiveScenes scenes={scenes} activeSceneId={activeSceneId} onRecall={recallScene} />
            </ResizablePanel>
            <PanelResizeHandle className="h-1 rounded-full bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent" />
            <ResizablePanel defaultSize={50} minSize={20}>
              <LiveChases />
            </ResizablePanel>
          </PanelGroup>
        </ResizablePanel>

        <PanelResizeHandle className="w-1 rounded-full bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent" />

        <ResizablePanel defaultSize={45} minSize={25}>
          <PanelGroup direction="vertical" className="h-full gap-2">
            <ResizablePanel defaultSize={45} minSize={20}>
              <LiveEffects effects={effects} runningEffectIds={runningEffectIds} />
            </ResizablePanel>
            <PanelResizeHandle className="h-1 rounded-full bg-transparent transition-colors hover:bg-accent/40 data-[resize-handle-active]:bg-accent" />
            <ResizablePanel defaultSize={55} minSize={20}>
              <LiveGroups groups={groups} />
            </ResizablePanel>
          </PanelGroup>
        </ResizablePanel>
      </PanelGroup>
    </div>
  );
}

function LiveStatusBar({
  hasActiveScene,
  runningEffectCount,
  groupCount,
  onBlackout,
}: {
  hasActiveScene: boolean;
  runningEffectCount: number;
  groupCount: number;
  onBlackout: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4 rounded-panel border border-border bg-panel px-3 py-2">
      <span className="text-xs font-medium tracking-wide text-text-secondary">LIVE MODE</span>
      <div className="h-4 w-px bg-border" />
      <span className="font-mono text-[11px] text-text-secondary">
        {hasActiveScene ? "escena activa · " : ""}
        {runningEffectCount} effect{runningEffectCount === 1 ? "" : "s"} corriendo · {groupCount} grupo
        {groupCount === 1 ? "" : "s"}
      </span>
      <div className="flex-1" />
      {/* Mismo componente y misma acción que el Blackout de la Topbar — una
       *  sola fuente de verdad (fixtureStore.blackout), no una copia local. */}
      <BlackoutButton onBlackout={onBlackout} />
    </div>
  );
}

function LiveScenes({
  scenes,
  activeSceneId,
  onRecall,
}: {
  scenes: ReturnType<typeof useFixtureStore>["scenes"];
  activeSceneId: string | null;
  onRecall: (sceneId: string) => void;
}) {
  return (
    <Panel title="ESCENAS — LIVE" className="h-full">
      {scenes.length === 0 ? (
        <p className="text-xs text-text-secondary">
          No hay escenas guardadas — créalas en Dashboard o Scenes antes del show.
        </p>
      ) : (
        <div className="flex flex-wrap content-start gap-2">
          {scenes.map((scene) => (
            <Button
              key={scene.id}
              size="lg"
              variant="secondary"
              selected={scene.id === activeSceneId}
              onClick={() => onRecall(scene.id)}
              className={cn(scene.id === activeSceneId && "bg-accent/15 text-accent")}
            >
              {scene.name}
            </Button>
          ))}
        </div>
      )}
    </Panel>
  );
}

function LiveChases() {
  const { chases, scenes, getChannelValue, setChannelValue } = useFixtureStore();
  const [selectedChaseId, setSelectedChaseId] = useState<string | null>(chases[0]?.id ?? null);

  useEffect(() => {
    if (selectedChaseId && !chases.some((c) => c.id === selectedChaseId)) {
      setSelectedChaseId(chases[0]?.id ?? null);
    }
  }, [chases, selectedChaseId]);

  const selectedChase = chases.find((c) => c.id === selectedChaseId) ?? null;
  const { status, play, stop } = useChasePlayer({
    chase: selectedChase,
    scenes,
    getChannelValue,
    setChannelValue,
  });

  return (
    <Panel title="CHASES — LIVE" className="h-full">
      {chases.length === 0 ? (
        <p className="text-xs text-text-secondary">No hay chases todavía — créalos en Chases.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {chases.map((c) => (
              <Button
                key={c.id}
                size="lg"
                variant="secondary"
                selected={c.id === selectedChaseId}
                onClick={() => {
                  if (c.id !== selectedChaseId) stop();
                  setSelectedChaseId(c.id);
                }}
                className={cn(c.id === selectedChaseId && "bg-accent/15 text-accent")}
              >
                {c.name}
              </Button>
            ))}
          </div>

          {selectedChase ? (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <Button
                size="lg"
                variant={status.playing ? "danger" : "primary"}
                onClick={status.playing ? stop : play}
                disabled={selectedChase.steps.length === 0}
              >
                {status.playing ? "■ Detener" : "▶ Reproducir"}
              </Button>
              {status.playing ? (
                <span className="font-mono text-[11px] text-text-secondary">
                  step {status.stepIndex + 1}/{selectedChase.steps.length} · {status.phase}{" "}
                  {Math.round(status.progress * 100)}%
                </span>
              ) : selectedChase.steps.length === 0 ? (
                <span className="text-[11px] text-text-secondary">Este chase no tiene steps todavía.</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function LiveEffects({
  effects,
  runningEffectIds,
}: {
  effects: ReturnType<typeof useFixtureStore>["effects"];
  runningEffectIds: string[];
}) {
  const { startEffect, stopEffect } = useFixtureStore();

  return (
    <Panel title="EFFECTS — LIVE" className="h-full">
      {effects.length === 0 ? (
        <p className="text-xs text-text-secondary">No hay effects todavía — créalos en Effects.</p>
      ) : (
        <div className="flex flex-wrap content-start gap-2">
          {effects.map((fx) => {
            const isRunning = runningEffectIds.includes(fx.id);
            return (
              <Button
                key={fx.id}
                size="lg"
                variant={isRunning ? "danger" : "secondary"}
                disabled={!fx.groupId}
                title={!fx.groupId ? "Sin grupo objetivo asignado" : undefined}
                onClick={() => (isRunning ? stopEffect(fx.id) : startEffect(fx.id))}
              >
                {isRunning ? "■ " : "▶ "}
                {fx.name}
              </Button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function LiveGroups({ groups }: { groups: ReturnType<typeof useFixtureStore>["groups"] }) {
  return (
    <Panel title="GROUPS — MASTER" className="h-full">
      {groups.length === 0 ? (
        <p className="text-xs text-text-secondary">No hay grupos todavía — créalos en Groups.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <GroupMasterRow key={g.id} groupId={g.id} groupName={g.name} groupColor={g.color} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Igual que GroupControl en GroupsView: fader de ESCRITURA por tipo de
 *  canal presente en el grupo, no un espejo del valor actual de cada
 *  fixture. Se repite un componente propio por grupo (en vez de reutilizar
 *  el de GroupsView) porque aquí conviven varios grupos a la vez en
 *  pantalla, cada uno con su propio estado local de posición de fader. */
function GroupMasterRow({
  groupId,
  groupName,
  groupColor,
}: {
  groupId: string;
  groupName: string;
  groupColor: string;
}) {
  const { instances, definitions, setGroupChannelByType } = useFixtureStore();
  const [localValues, setLocalValues] = useState<Record<string, number>>({});

  const members = instances.filter((i) => i.group === groupId);
  const channelTypes = useMemo(() => {
    const types = new Set<ChannelType>();
    for (const member of members) {
      const def = definitions.find((d) => d.id === member.definitionId);
      def?.channels.forEach((ch) => types.add(ch.type));
    }
    return Array.from(types);
  }, [members, definitions]);

  if (members.length === 0 || channelTypes.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-primary">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: groupColor }} aria-hidden />
        {groupName}
        <span className="font-mono text-[10px] font-normal text-text-secondary">
          {members.length} fixture{members.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {channelTypes.map((type) => (
          <Fader
            key={type}
            label={CHANNEL_TYPE_LABELS[type]}
            value={localValues[type] ?? 0}
            min={0}
            max={255}
            onChange={(v) => {
              setLocalValues((prev) => ({ ...prev, [type]: v }));
              setGroupChannelByType(groupId, type, v);
            }}
          />
        ))}
      </div>
    </div>
  );
}
