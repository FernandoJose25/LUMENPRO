import { useEffect, useMemo, useState } from "react";
import { Panel as ResizablePanel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { BlackoutButton } from "@/components/layout/BlackoutButton";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { ColorSwatches } from "@/components/fixtures/ColorSwatches";
import { PanTiltPad } from "@/components/fixtures/PanTiltPad";
import { PaletteChips } from "@/components/palettes/PalettesView";
import { PadBoard } from "@/components/pads/PadBoard";
import { LiveMoments } from "./LiveMoments";
import { HeldColors } from "./HeldColors";
import { Specials } from "./Specials";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";

/**
 * Live Mode (pendiente del roadmap — ver LUMENPRO-que-sigue.md) — pantalla
 * de OPERACIÓN, no de edición: sin crear/renombrar/borrar, sin ajustar
 * fade/hold de un chase ni parámetros de un effect. Controles grandes
 * ("sección 1", ver comentario de tamaños en ui/Button.tsx) pensados para
 * tocarse rápido durante un show, no para configurar con calma.
 */
export function LiveView() {
  const {
    scenes,
    activeSceneId,
    recallScene,
    effects,
    runningEffectIds,
    groups,
    blackoutActive,
    blackout,
    releaseBlackout,
  } = useFixtureStore();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
      <LiveStatusBar
        hasActiveScene={Boolean(activeSceneId)}
        runningEffectCount={runningEffectIds.length}
        groupCount={groups.length}
        blackoutActive={blackoutActive}
        onBlackout={blackout}
        onReleaseBlackout={releaseBlackout}
      />

      <LiveMoments />
      <HeldColors />
      <Specials />
      <LivePads />

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

/** Los botones que armó el usuario, arriba de todo. */
function LivePads() {
  const { livePads, setLivePads } = useFixtureStore();
  const [editing, setEditing] = useState(false);
  return (
    <section aria-label="Mis botones" className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-text-secondary">MIS BOTONES</span>
        <Button size="sm" variant={editing ? "primary" : "ghost"} onClick={() => setEditing(!editing)}>
          {editing ? "Listo" : "Editar"}
        </Button>
      </div>
      {livePads.length > 0 || editing ? <PadBoard pads={livePads} editing={editing} onChange={setLivePads} /> : null}
    </section>
  );
}

function LiveStatusBar({
  hasActiveScene,
  runningEffectCount,
  groupCount,
  blackoutActive,
  onBlackout,
  onReleaseBlackout,
}: {
  hasActiveScene: boolean;
  runningEffectCount: number;
  groupCount: number;
  blackoutActive: boolean;
  onBlackout: () => void;
  onReleaseBlackout: () => void;
}) {
  const { master, setMaster, speed, setSpeed, strobeActive, setStrobe } = useFixtureStore();
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
      <div className="w-72">
        <Fader label="Intensidad" value={master} max={100} onChange={setMaster} />
      </div>
      {/* Apura o frena los effects y chases; lo que sigue la música va con ella. */}
      <div className="flex w-80 items-center gap-1">
        <div className="min-w-0 flex-1">
          <Fader label="Velocidad" value={speed} min={25} max={400} step={5} unit="%" onChange={setSpeed} />
        </div>
        <Button size="sm" variant="ghost" title="Velocidad normal" disabled={speed === 100} onClick={() => setSpeed(100)}>
          1×
        </Button>
      </div>
      <Button
        variant={strobeActive ? "danger" : "secondary"}
        aria-pressed={strobeActive}
        onClick={() => setStrobe(!strobeActive)}
      >
        Estrobo
      </Button>
      {/* Mismo componente y misma acción que el Blackout de la Topbar — una
       *  sola fuente de verdad (fixtureStore.blackout), no una copia local. */}
      <BlackoutButton active={blackoutActive} onBlackout={onBlackout} onRelease={onReleaseBlackout} />
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
  const { chases, chase: playing, playChase, stopChase } = useFixtureStore();
  const [selectedChaseId, setSelectedChaseId] = useState<string | null>(chases[0]?.id ?? null);

  useEffect(() => {
    if (selectedChaseId && !chases.some((c) => c.id === selectedChaseId)) {
      setSelectedChaseId(chases[0]?.id ?? null);
    }
  }, [chases, selectedChaseId]);

  const selectedChase = chases.find((c) => c.id === selectedChaseId) ?? null;
  const status = playing?.id === selectedChaseId ? playing : null;

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
                onClick={() => setSelectedChaseId(c.id)}
                className={cn(c.id === selectedChaseId && "bg-accent/15 text-accent")}
              >
                {c.id === playing?.id ? "▶ " : ""}
                {c.name}
              </Button>
            ))}
          </div>

          {selectedChase ? (
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <Button
                size="lg"
                variant={status ? "danger" : "primary"}
                onClick={() => (status ? stopChase() : playChase(selectedChase.id))}
                disabled={selectedChase.steps.length === 0}
              >
                {status ? "■ Detener" : "▶ Reproducir"}
              </Button>
              {status ? (
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
      <p className="mb-3 text-[11px] text-text-secondary">
        Lo que cambies aquí dura hasta el próximo momento. Para que quede, usa “Guardar cambios en…” arriba; si un
        color no cambia, puede estar puesto el Color fijo.
      </p>
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

/** Un fader por tipo de canal del grupo. Muestra lo que tiene ahora la
 *  primera luz del grupo con ese canal: así no vuelve a 0 al salir de Live y
 *  regresar, y se ve el valor de verdad (el blanco de Fotos tiene el verde y
 *  el azul a tope). */
function GroupMasterRow({
  groupId,
  groupName,
  groupColor,
}: {
  groupId: string;
  groupName: string;
  groupColor: string;
}) {
  const { instances, definitions, liveValues, setGroupChannelByType } = useFixtureStore();

  const members = instances.filter((i) => i.group === groupId);
  const channelTypes = useMemo(() => {
    const types = new Set<ChannelType>();
    for (const member of members) {
      const def = definitions.find((d) => d.id === member.definitionId);
      def?.channels.forEach((ch) => ch.type !== "FINE" && types.add(ch.type));
    }
    return Array.from(types);
  }, [members, definitions]);
  const valueOf = (type: ChannelType) => {
    for (const member of members) {
      const channel = definitions.find((d) => d.id === member.definitionId)?.channels.find((c) => c.type === type);
      if (channel) return liveValues[member.id]?.[channel.id] ?? channel.defaultValue;
    }
    return 0;
  };

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
      <div className="mb-2 flex flex-col gap-2">
        <ColorSwatches instances={members} />
        <PaletteChips instanceIds={members.map((m) => m.id)} />
      </div>
      <div className="flex flex-col gap-2">
        <PanTiltPad instances={members} />
        {channelTypes.map((type) => (
          <Fader
            key={type}
            label={CHANNEL_TYPE_LABELS[type]}
            value={valueOf(type)}
            min={0}
            max={255}
            onChange={(v) => setGroupChannelByType(groupId, type, v)}
          />
        ))}
      </div>
    </div>
  );
}
