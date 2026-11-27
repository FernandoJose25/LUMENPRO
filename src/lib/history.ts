import type { Chase } from "@/types/chase";
import type { Effect } from "@/types/effect";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Group } from "@/types/group";
import type { Moment } from "@/types/moment";
import type { Palette } from "@/types/palette";
import type { Control, Pad } from "@/types/controls";
import type { Scene } from "@/types/scene";
import type { Timeline } from "@/types/timeline";
import type { PlaylistSong } from "@/types/music";
import type { Special } from "@/types/special";

/** Lo que se programa, que es lo que Deshacer recupera. Los valores en vivo
 *  quedan fuera a propósito: deshacer a mitad del evento no debe mover luces. */
export interface ShowDoc {
  definitions: FixtureDefinition[];
  instances: FixtureInstance[];
  scenes: Scene[];
  palettes: Palette[];
  groups: Group[];
  chases: Chase[];
  effects: Effect[];
  moments: Moment[];
  timelines: Timeline[];
  /** Las canciones de la hora loca (lib/musicPlayer.ts). */
  playlist: PlaylistSong[];
  /** Humo, chispas frías, CO2, confeti. */
  specials: Special[];
  livePads: Pad[];
  phonePads: Pad[];
  controls: Control[];
}

const KEYS = [
  "definitions", "instances", "scenes", "palettes", "groups", "chases", "effects", "moments", "timelines", "playlist",
  "specials", "livePads", "phonePads", "controls",
] as const;

const LIMIT = 100;
// Escribir un nombre o arrastrar una luz son muchos cambios seguidos, pero un
// solo paso para quien los deshace.
const COALESCE_MS = 800;

export interface History {
  past: ShowDoc[];
  future: ShowDoc[];
  lastChangeAt: number;
  /** Listas tocadas por el último cambio, si fue una edición sin altas ni bajas. */
  lastEdited: string;
}

export const EMPTY_HISTORY: History = { past: [], future: [], lastChangeAt: 0, lastEdited: "" };

export function docOf(state: ShowDoc): ShowDoc {
  return Object.fromEntries(KEYS.map((k) => [k, state[k]])) as unknown as ShowDoc;
}

export function sameDoc(a: ShowDoc, b: ShowDoc): boolean {
  return KEYS.every((k) => a[k] === b[k]);
}

export function recordChange(history: History, before: ShowDoc, after: ShowDoc, now: number): History {
  const changed = KEYS.filter((k) => before[k] !== after[k]);
  const edited = changed.every((k) => before[k].length === after[k].length) ? changed.join() : "";
  const continues = edited !== "" && edited === history.lastEdited && now - history.lastChangeAt < COALESCE_MS;
  return {
    past: continues ? history.past : [...history.past, before].slice(-LIMIT),
    future: [],
    lastChangeAt: now,
    lastEdited: edited,
  };
}

/** El doc al que se vuelve (-1 deshacer, 1 rehacer), o null si no hay. */
export function travel(
  history: History,
  current: ShowDoc,
  direction: -1 | 1,
): { history: History; doc: ShowDoc } | null {
  const { past, future } = history;
  const doc = direction === -1 ? past[past.length - 1] : future[0];
  if (!doc) return null;
  return {
    doc,
    history: {
      past: direction === -1 ? past.slice(0, -1) : [...past, current],
      future: direction === -1 ? [current, ...future] : future.slice(1),
      lastChangeAt: 0,
      lastEdited: "",
    },
  };
}
