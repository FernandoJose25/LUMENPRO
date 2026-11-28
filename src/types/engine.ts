import type { Action } from "@/types/controls";
import type { ChannelValues } from "@/lib/fade";
import type { ShowDoc } from "@/lib/history";
import type { QuickColor } from "@/lib/palettes";

/** Lo que está pasando ahora, según el motor (show-engine/src/show.rs). */
export interface Playback {
  activeSceneId: string | null;
  runningEffectIds: string[];
  blackoutActive: boolean;
  master: number;
  strobeActive: boolean;
  identifyId: string | null;
  activeMomentId: string | null;
  momentRun: { nonce: number; startedAt: number } | null;
  chase: ChaseStatus | null;
  /** Color fijo de cada grupo ("" = las luces sin grupo): grupo -> "#ff0000". */
  heldColors: Record<string, string>;
  /** La línea de tiempo que suena. */
  timeline: TimelineRun | null;
  /** El ritmo marcado a mano (Tap); mientras haya uno, manda sobre lo que se escucha. */
  tapBpm: number | null;
  /** Velocidad de los effects y chases, en % (100 = la suya); lo que sigue la música no cambia. */
  speed: number;
  /** Efectos especiales disparando: id -> hasta qué hora del motor. */
  firing: Record<string, number>;
  /** Efectos especiales armados: id -> hasta qué hora del motor. */
  armed: Record<string, number>;
  /** El tempo que manda VirtualDJ (OS2L) mientras llegan golpes. */
  djBpm: number | null;
  /** Piloto automático: cambia solo de momento según cómo suena la música. */
  autopilotOn: boolean;
  /** Cómo suena: -1 calmada, 0 normal, 1 intensa; null sin escuchar. */
  intensity: -1 | 0 | 1 | null;
}

export interface TimelineRun {
  id: string;
  /** Hora del motor en que la canción estaba (o habría estado) en 0. */
  startedAt: number;
  /** En pausa: dónde quedó la canción, en ms. */
  pausedAt: number | null;
}

/** Lo programado y lo que el motor calcula de ahí sin que se guarde. */
export type EngineDoc = ShowDoc & { colors: QuickColor[] };

export interface ChaseStatus {
  id: string;
  stepIndex: number;
  phase: "fade" | "hold";
  /** 0–1 dentro de la fase actual (no del chase completo). */
  progress: number;
}

export interface AudioMessage {
  levels: { bass: number; mid: number; treble: number };
  beat: { beats: number; bpm: number } | null;
  /** Golpes contados por banda: lo que sigue a una banda avanza con ellos. */
  hits?: { bass: number; mid: number; treble: number };
  /** Cómo suena la música: -1 calmada, 0 normal, 1 intensa (piloto automático). */
  intensity?: -1 | 0 | 1 | null;
}

export type EngineMessage =
  | {
      type: "reset";
      doc: EngineDoc;
      live: ChannelValues;
      activeSceneId: string | null;
      activeMomentId: string | null;
    }
  | { type: "doc"; doc: EngineDoc }
  | { type: "values"; values: ChannelValues }
  | { type: "activeScene"; id: string | null }
  | { type: "recallScene" | "startEffect" | "stopEffect" | "identify" | "startMoment" | "playChase"; id: string }
  | { type: "blackout" | "strobe"; on: boolean }
  | { type: "master" | "speed"; value: number }
  | { type: "stepMoment"; direction: -1 | 1 }
  | { type: "stopMoment" | "stopChase" }
  | { type: "audio"; audio: AudioMessage | null }
  | { type: "autopilot"; on: boolean }
  | { type: "action"; action: Action; press?: boolean; value?: number }
  /** Desde ese punto de la canción; también para seguir tras una pausa. */
  | { type: "playTimeline"; id: string; fromMs: number }
  | { type: "pauseTimeline" | "stopTimeline" }
  /** Por dónde va la canción que suena en la ventana: el motor la sigue. */
  | { type: "timelineSync"; id: string; positionMs: number }
  /** Un toque al ritmo; `at`, la hora del motor en que se tocó. */
  | { type: "tap"; at?: number }
  | { type: "clearTap" }
  | { type: "fire"; id: string; on: boolean }
  | { type: "arm"; id: string; on?: boolean };

export interface EngineChanges {
  rev: number;
  /** La hora del motor (ver lib/engineClock.ts). */
  now?: number;
  /** Los valores son todos, no solo los que cambiaron. */
  full: boolean;
  values: ChannelValues;
  /** Pan y tilt de las cabezas que dibujan una figura: todos, cuando cambian. */
  moving?: ChannelValues;
  playback?: Playback;
}

export type DmxAdapter = "open_dmx" | "enttec" | "artnet" | "sacn" | "mock";

/** Por dónde sale un universo del show. */
export interface OutputConfig {
  id: string;
  adapter: DmxAdapter;
  /** Universo del show. */
  universe: number;
  fps: number;
  /** Los de USB: "COM5". */
  port: string;
  /** Los de red: IP del nodo, o vacío para toda la red. */
  host: string;
  /** Los de red: número de universo del otro lado. */
  target: number;
}

export type OutputState = "stopped" | "running" | "reconnecting";

export interface OutputStatus {
  config: OutputConfig;
  state: OutputState;
  name: string;
  lastError: string | null;
  fps: number;
  /** La pausa más larga entre dos frames desde que se conectó. */
  worstGapMs: number;
}

export interface EngineStatus {
  /** "stopped" si no hay salidas; con varias, la peor. */
  state: OutputState;
  outputs: OutputStatus[];
  /** Del motor mismo, no de una salida. */
  lastError?: string;
}

export const DMX_STOPPED: EngineStatus = { state: "stopped", outputs: [] };

/** El show que el motor ya tenía en marcha cuando se abrió la ventana. */
export interface Session {
  doc: ShowDoc;
  live: ChannelValues;
  playback: Playback;
}
