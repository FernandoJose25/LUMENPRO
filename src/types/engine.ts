import type { ChannelValues } from "@/lib/fade";
import type { ShowDoc } from "@/lib/history";

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
}

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
}

export type EngineMessage =
  | {
      type: "reset";
      doc: ShowDoc;
      live: ChannelValues;
      activeSceneId: string | null;
      activeMomentId: string | null;
    }
  | { type: "doc"; doc: ShowDoc }
  | { type: "values"; values: ChannelValues }
  | { type: "activeScene"; id: string | null }
  | { type: "recallScene" | "startEffect" | "stopEffect" | "identify" | "startMoment" | "playChase"; id: string }
  | { type: "blackout" | "strobe"; on: boolean }
  | { type: "master"; value: number }
  | { type: "stepMoment"; direction: -1 | 1 }
  | { type: "stopMoment" | "stopChase" }
  | { type: "audio"; audio: AudioMessage | null };

export interface EngineChanges {
  rev: number;
  /** Los valores son todos, no solo los que cambiaron. */
  full: boolean;
  values: ChannelValues;
  playback?: Playback;
}

/** Salida DMX. */
export interface EngineStatus {
  state: "stopped" | "running" | "reconnecting";
  output: string;
  lastError: string | null;
  fps: number;
  /** La pausa más larga entre dos frames desde que se conectó. */
  worstGapMs: number;
}

export const DMX_STOPPED: EngineStatus = { state: "stopped", output: "", lastError: null, fps: 0, worstGapMs: 0 };

/** El show que el motor ya tenía en marcha cuando se abrió la ventana. */
export interface Session {
  doc: ShowDoc;
  live: ChannelValues;
  playback: Playback;
}
