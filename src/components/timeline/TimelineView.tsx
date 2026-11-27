import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { cn } from "@/lib/utils";
import { askConfirm, askText } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import { engineNow, positionOf } from "@/lib/engineClock";
import { SWATCHES } from "@/lib/look";
import { colorRows } from "@/lib/palettes";
import { saveSong, songShape, type SongShape } from "@/lib/songs";
import { setSongOutput, songOutput } from "@/lib/timelineAudio";
import type { Action } from "@/types/controls";
import type { TimelineRun } from "@/types/engine";
import type { Timeline, TimelineCue } from "@/types/timeline";

type Lane = "moment" | "color" | "effect" | "flash";

const LANES: { id: Lane; name: string }[] = [
  { id: "moment", name: "Momentos" },
  { id: "color", name: "Color fijo" },
  { id: "effect", name: "Efectos" },
  { id: "flash", name: "Estrobo y apagón" },
];

function laneOf(action: Action): Lane {
  if (action.do === "moment") return "moment";
  if (action.do === "color") return "color";
  if (action.do === "effect" || action.do === "chase") return "effect";
  return "flash";
}

/** "1:05.3" */
export function formatTime(ms: number): string {
  const tenths = Math.max(0, Math.round(ms / 100));
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${tenths % 10}`;
}

const cueId = () => `cue-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const byTime = (cues: TimelineCue[]) => [...cues].sort((a, b) => a.atMs - b.atMs);
/** Sin canción, se ve al menos un minuto. */
const EMPTY_VIEW_MS = 60_000;
const MAX_WIDTH = 30_000;
const LANE_PX = 34;

/** Lo que se ve de un vals, de un vistazo. */
export function TimelineView() {
  const { timelines, addTimeline, removeTimeline, updateTimeline, timeline: run } = useFixtureStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = timelines.find((t) => t.id === selectedId) ?? timelines[0];

  function handleCreate() {
    askText("Nombre de la línea de tiempo", timelines.length === 0 ? "Vals" : `Canción ${timelines.length + 1}`, (name) =>
      setSelectedId(addTimeline(name).id),
    );
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-60 shrink-0">
        <Panel title="LÍNEAS DE TIEMPO">
          <ul className="flex flex-col gap-1.5">
            {timelines.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center gap-2 rounded-control border px-2.5 py-1.5 text-sm",
                  t === selected ? "border-accent bg-accent/15" : "border-border bg-panel2",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  onDoubleClick={() => askText("Nombre", t.name, (name) => updateTimeline(t.id, { name: name.trim() || t.name }))}
                  className={cn("min-w-0 flex-1 truncate text-left", run?.id === t.id ? "text-accent" : "text-text-primary")}
                >
                  {t.name}
                </button>
                <button
                  type="button"
                  aria-label={`Borrar ${t.name}`}
                  onClick={() =>
                    askConfirm(`¿Borrar la línea de tiempo "${t.name}"? Sus momentos y effects no se borran.`, "Borrar", () =>
                      removeTimeline(t.id),
                    )
                  }
                  className="h-6 w-6 rounded-control text-text-secondary hover:bg-panel hover:text-text-primary"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <Button variant="primary" className="mt-2 w-full" onClick={handleCreate}>
            + Nueva línea de tiempo
          </Button>
          <p className="mt-3 text-xs text-text-secondary">
            Carga la canción del vals y pon en cada segundo un momento, un color, un efecto o un golpe de estrobo. Al darle
            Reproducir, todo sale a tiempo con la música. También se arranca desde el celular.
          </p>
        </Panel>
      </div>
      {selected ? (
        <TimelineEditor key={selected.id} timeline={selected} />
      ) : (
        <Panel title="LÍNEA DE TIEMPO" className="flex-1">
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-text-secondary">
            <span>Todavía no hay ninguna. Empieza por la del vals.</span>
            <Button variant="primary" onClick={() => setSelectedId(addTimeline("Vals").id)}>
              Crear la del vals
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

/** Por dónde va: la del motor si suena, si no la línea blanca. */
function usePosition(run: TimelineRun | null, cursor: number): number {
  const [, setNow] = useState(engineNow);
  const playing = run !== null && run.pausedAt === null;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setNow(engineNow()), 50);
    return () => clearInterval(timer);
  }, [playing]);
  return run ? Math.max(0, positionOf(run)) : cursor;
}

function TimelineEditor({ timeline }: { timeline: Timeline }) {
  const store = useFixtureStore();
  const { moments, effects, timelines, updateTimeline, playTimeline, pauseTimeline, stopTimeline } = store;
  const run = store.timeline?.id === timeline.id ? store.timeline : null;
  const other = store.timeline && !run ? timelines.find((t) => t.id === store.timeline?.id) : undefined;
  const playing = run !== null && run.pausedAt === null;

  const [cursor, setCursor] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [shape, setShape] = useState<SongShape | null>(null);
  const [songError, setSongError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const position = usePosition(run, cursor);

  // Al terminar o detenerse, la línea blanca queda donde iba.
  const last = useRef(position);
  useEffect(() => {
    if (run) last.current = position;
  });
  const wasRunning = useRef(run !== null);
  useEffect(() => {
    if (wasRunning.current && !run) setCursor(last.current);
    wasRunning.current = run !== null;
  }, [run]);

  const song = timeline.song;
  useEffect(() => {
    setShape(null);
    if (!song) return;
    let alive = true;
    songShape(song).then(
      (s) => {
        if (!alive) return;
        setShape(s);
        setSongError(null);
      },
      () => alive && setSongError(`No encuentro la canción «${song.name}»: vuelve a cargarla.`),
    );
    return () => {
      alive = false;
    };
  }, [song]);

  const cueEnd = Math.max(0, ...timeline.cues.map((c) => c.atMs + (c.lengthMs ?? 0)));
  const endMs = Math.max(timeline.durationMs, cueEnd);
  const viewMs = timeline.durationMs > 0 ? endMs : Math.max(EMPTY_VIEW_MS, cueEnd + 10_000);

  // Ancho: el de la pantalla, por el zoom.
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1000);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFit(Math.max(300, element.clientWidth - 2)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = Math.min(MAX_WIDTH, fit * zoom);
  const x = (ms: number) => (ms / viewMs) * width;
  const msAt = (px: number) => (px / width) * viewMs;

  // Que la línea blanca no se salga de la vista mientras suena.
  useEffect(() => {
    const element = scroller.current;
    if (!playing || !element) return;
    const at = x(position);
    if (at < element.scrollLeft || at > element.scrollLeft + element.clientWidth - 40) element.scrollLeft = at - 80;
  });

  function goTo(ms: number) {
    const at = Math.max(0, Math.min(ms, endMs || viewMs));
    if (playing) return playTimeline(timeline.id, at);
    if (run) stopTimeline();
    setCursor(at);
  }

  function stop() {
    setCursor(position);
    stopTimeline();
  }

  function setCues(cues: TimelineCue[]) {
    updateTimeline(timeline.id, { cues: byTime(cues) });
  }

  function addCue(action: Action, lengthMs: number | null) {
    const cue: TimelineCue = { id: cueId(), atMs: Math.round(position / 10) * 10, lengthMs, action };
    setCues([...timeline.cues, cue]);
    setSelectedId(cue.id);
  }

  function patchCue(id: string, patch: Partial<Omit<TimelineCue, "id">>) {
    setCues(timeline.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // El momento que sigue al último que ya está puesto antes de la línea.
  function nextMoment() {
    const before = timeline.cues.filter((c) => c.action.do === "moment" && c.atMs <= position).pop();
    const index = before && "id" in before.action ? moments.findIndex((m) => m.id === (before.action as { id: string }).id) : -1;
    return moments[index + 1] ?? moments[0];
  }
  const colorable = colorRows(store);
  const groupedEffects = effects.filter((e) => e.groupId);

  async function handleSong(file: File) {
    if (run) stopTimeline();
    setLoading(true);
    try {
      const saved = await saveSong(file);
      const loaded = await songShape(saved);
      updateTimeline(timeline.id, { song: saved, durationMs: loaded.durationMs });
      setSongError(null);
    } catch {
      setSongError("No pude leer esa canción. Prueba con un MP3.");
    } finally {
      setLoading(false);
    }
  }

  const selected = timeline.cues.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="shrink-0">
        <Panel title="LÍNEA DE TIEMPO">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Nombre"
              value={timeline.name}
              onChange={(e) => updateTimeline(timeline.id, { name: e.target.value })}
              className="h-9 w-44 rounded-control border border-border bg-panel2 px-2 text-sm font-semibold text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
            />
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control border border-border bg-panel2 px-3 text-sm text-text-primary hover:bg-panel2/70">
              {loading ? "Cargando…" : song ? "Cambiar canción" : "Cargar canción"}
              <input
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg"
                aria-label="Canción"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleSong(file);
                }}
              />
            </label>
            <span className="min-w-0 truncate text-xs text-text-secondary">
              {song ? `${song.name} · ${formatTime(timeline.durationMs)}` : "Sin canción: las luces corren igual, sin música."}
            </span>
            <OutputPicker />
          </div>
          {songError ? <p className="mt-2 text-xs text-state-danger">{songError}</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {playing ? (
              <Button variant="primary" onClick={pauseTimeline}>
                ❚❚ Pausa
              </Button>
            ) : (
              <Button variant="primary" onClick={() => playTimeline(timeline.id, run?.pausedAt ?? cursor)}>
                ▶ Reproducir
              </Button>
            )}
            <Button onClick={stop} disabled={!run}>
              ■ Detener
            </Button>
            <Button variant="ghost" onClick={() => goTo(0)}>
              ⏮ Al inicio
            </Button>
            <span className="font-mono text-sm text-text-primary" aria-label="Tiempo">
              {formatTime(position)} / {formatTime(endMs)}
            </span>
            {other ? <span className="text-xs text-text-secondary">Ahora suena «{other.name}».</span> : null}
            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label="Alejar" onClick={() => setZoom((z) => Math.max(1, z / 2))}>
                −
              </Button>
              <span className="w-10 text-center text-xs text-text-secondary">×{zoom}</span>
              <Button size="sm" variant="ghost" aria-label="Acercar" onClick={() => setZoom((z) => Math.min(16, z * 2))}>
                +
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Agregar marca">
            <Button
              size="sm"
              disabled={moments.length === 0}
              title={moments.length === 0 ? "Primero arma los momentos en Momentos" : undefined}
              onClick={() => addCue({ do: "moment", id: nextMoment().id }, null)}
            >
              + Momento
            </Button>
            <Button
              size="sm"
              disabled={colorable.length === 0}
              onClick={() => addCue({ do: "color", groupId: colorable.length > 1 ? null : colorable[0].id, color: SWATCHES[0].hex }, null)}
            >
              + Color fijo
            </Button>
            <Button
              size="sm"
              disabled={groupedEffects.length === 0}
              onClick={() => addCue({ do: "effect", id: groupedEffects[0].id }, null)}
            >
              + Efecto
            </Button>
            <Button size="sm" onClick={() => addCue({ do: "strobe" }, 2000)}>
              + Estrobo
            </Button>
            <Button size="sm" onClick={() => addCue({ do: "blackout" }, null)}>
              + Apagón
            </Button>
            <span className="text-[11px] text-text-secondary">
              Se ponen donde está la línea blanca. Con la canción sonando, tócalos al ritmo y después afínalos arrastrándolos.
            </span>
          </div>
        </Panel>
      </div>

      <div className="shrink-0 rounded-panel border border-border bg-panel p-2">
        <div className="flex">
          <div className="w-32 shrink-0 pt-[76px]">
            {LANES.map((lane) => (
              <div key={lane.id} className="flex items-center text-xs text-text-secondary" style={{ height: LANE_PX }}>
                {lane.name}
              </div>
            ))}
          </div>
          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto scrollbar-thin">
            <div className="relative" style={{ width }}>
              <div
                role="slider"
                aria-label="Posición en la canción"
                aria-valuemin={0}
                aria-valuemax={Math.round(viewMs)}
                aria-valuenow={Math.round(position)}
                aria-valuetext={formatTime(position)}
                tabIndex={0}
                className="relative h-[76px] cursor-pointer"
                onPointerDown={(e) => goTo(msAt(e.clientX - e.currentTarget.getBoundingClientRect().left))}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 100 : 1000;
                  if (e.key === "ArrowRight") goTo(position + step);
                  if (e.key === "ArrowLeft") goTo(position - step);
                }}
              >
                <Ruler viewMs={viewMs} width={width} />
                <Waveform shape={shape} viewMs={viewMs} width={width} />
              </div>
              {LANES.map((lane) => (
                <div key={lane.id} className="relative border-t border-border/60" style={{ height: LANE_PX }}>
                  {timeline.cues
                    .filter((c) => laneOf(c.action) === lane.id)
                    .map((cue) => (
                      <CueBlock
                        key={cue.id}
                        cue={cue}
                        left={x(cue.atMs)}
                        width={cue.lengthMs ? Math.max(12, x(cue.lengthMs)) : 0}
                        label={cueLabel(cue, store)}
                        color={cue.action.do === "color" ? cue.action.color : null}
                        selected={cue.id === selectedId}
                        onSelect={() => setSelectedId(cue.id)}
                        onMove={(atMs) => patchCue(cue.id, { atMs: Math.max(0, Math.round(atMs / 10) * 10) })}
                        msAt={msAt}
                      />
                    ))}
                </div>
              ))}
              <div
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
                style={{ left: x(position) }}
                aria-hidden
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="w-[26rem] shrink-0">
          <Panel title="MARCA">
            {selected ? (
              <CueInspector
                key={selected.id}
                cue={selected}
                onChange={(patch) => patchCue(selected.id, patch)}
                onDelete={() => {
                  setCues(timeline.cues.filter((c) => c.id !== selected.id));
                  setSelectedId(null);
                }}
                onHere={() => patchCue(selected.id, { atMs: Math.round(position / 10) * 10 })}
                onListen={() => playTimeline(timeline.id, Math.max(0, selected.atMs - 2000))}
              />
            ) : (
              <p className="text-xs text-text-secondary">
                Toca una marca para cambiarla. Toca la regla de arriba para mover la línea blanca.
              </p>
            )}
          </Panel>
        </div>
        <div className="min-w-0 flex-1">
          <Panel title="SIMULADOR">
            <StageCanvas rig={store} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

type Store = ReturnType<typeof useFixtureStore>;

function cueLabel(cue: TimelineCue, store: Store): string {
  const a = cue.action;
  switch (a.do) {
    case "moment":
      return store.moments.find((m) => m.id === a.id)?.name ?? "(momento borrado)";
    case "effect":
      return store.effects.find((e) => e.id === a.id)?.name ?? "(efecto borrado)";
    case "color": {
      const lights = a.groupId === null ? "Todas" : colorRows(store).find((r) => r.id === a.groupId)?.name ?? "(grupo borrado)";
      const color = a.color === null ? "la del momento" : SWATCHES.find((s) => s.hex === a.color)?.name ?? a.color;
      return `${lights}: ${color}`;
    }
    case "strobe":
      return "Estrobo";
    case "blackout":
      return "Apagón";
    default:
      return a.do;
  }
}

function Ruler({ viewMs, width }: { viewMs: number; width: number }) {
  const pxPerSec = width / (viewMs / 1000);
  const step = [1, 2, 5, 10, 15, 30, 60].find((s) => s * pxPerSec >= 60) ?? 60;
  const marks = Array.from({ length: Math.floor(viewMs / 1000 / step) + 1 }, (_, n) => n * step);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-5 border-b border-border/60" aria-hidden>
      {marks.map((s) => (
        <span key={s} className="absolute top-0 h-full border-l border-border/80 pl-1 text-[10px] text-text-secondary" style={{ left: (s / (viewMs / 1000)) * width }}>
          {formatTime(s * 1000).replace(/\.0$/, "")}
        </span>
      ))}
    </div>
  );
}

const WAVE_PX = 52;

function Waveform({ shape, viewMs, width }: { shape: SongShape | null; viewMs: number; width: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element || !shape) return;
    element.width = Math.round(width);
    element.height = WAVE_PX;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, element.width, WAVE_PX);
    ctx.fillStyle = "rgba(167, 139, 250, 0.6)";
    const songPx = (shape.durationMs / viewMs) * width;
    const bar = Math.max(1, songPx / shape.peaks.length);
    shape.peaks.forEach((peak, n) => {
      const h = Math.max(1, peak * (WAVE_PX / 2));
      ctx.fillRect((n / shape.peaks.length) * songPx, WAVE_PX / 2 - h, bar, h * 2);
    });
  }, [shape, viewMs, width]);
  return <canvas ref={canvas} className="pointer-events-none absolute left-0 top-6" style={{ width, height: WAVE_PX }} aria-hidden />;
}

interface CueBlockProps {
  cue: TimelineCue;
  left: number;
  /** 0 = una marca sin duración. */
  width: number;
  label: string;
  color: string | null;
  selected: boolean;
  onSelect: () => void;
  onMove: (atMs: number) => void;
  msAt: (px: number) => number;
}

/** Se arrastra para moverla; se toca para elegirla. */
function CueBlock({ cue, left, width, label, color, selected, onSelect, onMove, msAt }: CueBlockProps) {
  const drag = useRef<{ x: number; at: number } | null>(null);
  const dragged = useRef(false);
  return (
    <button
      type="button"
      aria-label={`${formatTime(cue.atMs)} ${label}`}
      aria-pressed={selected}
      title={`${formatTime(cue.atMs)} · ${label}`}
      className={cn(
        "absolute top-1 flex h-[26px] touch-none select-none items-center gap-1 overflow-hidden whitespace-nowrap rounded-control border px-1.5 text-[11px]",
        width > 0 ? "" : "min-w-0 max-w-40",
        selected ? "z-10 border-text-primary bg-accent text-bg" : "border-accent/60 bg-accent/25 text-text-primary",
      )}
      style={{ left, width: width > 0 ? width : undefined }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, at: cue.atMs };
        dragged.current = false;
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 3) dragged.current = true;
        if (dragged.current) onMove(d.at + msAt(dx));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onSelect();
      }}
    >
      {color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/30" style={{ background: color }} aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

const fieldClass =
  "h-8 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

interface CueInspectorProps {
  cue: TimelineCue;
  onChange: (patch: Partial<Omit<TimelineCue, "id">>) => void;
  onDelete: () => void;
  onHere: () => void;
  onListen: () => void;
}

function CueInspector({ cue, onChange, onDelete, onHere, onListen }: CueInspectorProps) {
  const store = useFixtureStore();
  const a = cue.action;
  const lane = LANES.find((l) => l.id === laneOf(a))!;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="text-xs font-medium tracking-wide text-text-secondary">{lane.name.toUpperCase()}</div>

      {a.do === "moment" ? (
        <select aria-label="Momento" value={a.id} onChange={(e) => onChange({ action: { do: "moment", id: e.target.value } })} className={fieldClass}>
          {store.moments.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : null}

      {a.do === "effect" ? (
        <select aria-label="Efecto" value={a.id} onChange={(e) => onChange({ action: { do: "effect", id: e.target.value } })} className={fieldClass}>
          {store.effects
            .filter((e) => e.groupId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      ) : null}

      {a.do === "color" ? (
        <div className="flex flex-col gap-2">
          <select
            aria-label="Luces"
            value={a.groupId ?? "*"}
            onChange={(e) => onChange({ action: { ...a, groupId: e.target.value === "*" ? null : e.target.value } })}
            className={fieldClass}
          >
            {colorRows(store).length > 1 ? <option value="*">Todas</option> : null}
            {colorRows(store).map((r) => (
              <option key={r.id || "*"} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((s) => (
              <button
                key={s.hex}
                type="button"
                aria-label={s.name}
                aria-pressed={a.color === s.hex}
                onClick={() => onChange({ action: { ...a, color: s.hex } })}
                className={cn("h-7 w-7 rounded-control border", a.color === s.hex ? "border-text-primary ring-2 ring-accent" : "border-border")}
                style={{ background: s.hex }}
              />
            ))}
            <Button size="sm" selected={a.color === null} onClick={() => onChange({ action: { ...a, color: null } })}>
              La del momento
            </Button>
          </div>
        </div>
      ) : null}

      <label className="flex items-center gap-2">
        <span className="w-20 text-xs text-text-secondary">Segundo</span>
        <SecondsField
          label="Segundo"
          valueMs={cue.atMs}
          onCommit={(ms) => ms !== null && onChange({ atMs: Math.max(0, ms) })}
        />
        <Button size="sm" variant="ghost" aria-label="Antes" onClick={() => onChange({ atMs: Math.max(0, cue.atMs - 100) })}>
          −0,1
        </Button>
        <Button size="sm" variant="ghost" aria-label="Después" onClick={() => onChange({ atMs: cue.atMs + 100 })}>
          +0,1
        </Button>
      </label>

      {a.do !== "moment" ? (
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs text-text-secondary">Dura</span>
          <SecondsField label="Dura" valueMs={cue.lengthMs} onCommit={(ms) => onChange({ lengthMs: ms && ms > 0 ? ms : null })} />
          <span className="text-[11px] text-text-secondary">segundos · vacío: hasta que otra marca lo cambie</span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onListen}>
          ▶ Escuchar desde aquí
        </Button>
        <Button size="sm" variant="ghost" onClick={onHere}>
          Poner en la línea blanca
        </Button>
        <Button size="sm" variant="danger" onClick={onDelete}>
          Borrar marca
        </Button>
      </div>
    </div>
  );
}

/** Segundos con un decimal; vacío = null. Se aplica al salir o con Enter. */
function SecondsField({ label, valueMs, onCommit }: { label: string; valueMs: number | null; onCommit: (ms: number | null) => void }) {
  const shown = valueMs === null ? "" : String(Math.round(valueMs / 100) / 10);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    if (trimmed === "") return onCommit(null);
    const seconds = Number(trimmed);
    if (Number.isFinite(seconds)) onCommit(Math.round(seconds * 1000));
    else setText(shown);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={cn(fieldClass, "w-20 font-mono")}
    />
  );
}

/** Por dónde sale la canción: la salida de Windows o, por ejemplo, la
 *  tarjeta USB que va a la consola del DJ. */
export function OutputPicker() {
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [value, setValue] = useState(songOutput);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => setOutputs(list.filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications")))
      .catch(() => {});
  }, []);
  if (outputs.length === 0) return null;
  return (
    <label className="ml-auto flex items-center gap-2 text-xs text-text-secondary">
      Sale por
      <select
        aria-label="Salida de la canción"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSongOutput(e.target.value);
        }}
        className={fieldClass}
      >
        <option value="">La de Windows</option>
        {outputs.map((d, n) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Salida ${n + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
