import type { Song } from "@/types/timeline";

/** Una canción de la lista de la hora loca, con su ritmo ya analizado
 *  (lib/beatGrid.ts): mientras suena, las luces saben en qué golpe va. */
export interface PlaylistSong extends Song {
  id: string;
  durationMs: number;
  /** null si no se encontró un ritmo (una balada, un discurso). */
  bpm: number | null;
  /** Dónde cae el primer golpe, en ms. */
  firstBeatMs: number;
}
