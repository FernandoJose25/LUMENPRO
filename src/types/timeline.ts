import type { Action } from "@/types/controls";

/**
 * Lo que pasa en cada segundo de una canción (el vals). El motor dispara las
 * marcas (show-engine, `Timeline`); la canción la reproduce la ventana.
 */
export interface Timeline {
  id: string;
  name: string;
  /** Guardada con la app (lib/songs.ts); null hasta que se elige. */
  song: Song | null;
  /** Lo que dura la canción. */
  durationMs: number;
  cues: TimelineCue[];
}

export interface Song {
  /** Nombre del archivo guardado. */
  file: string;
  /** Como se llamaba el archivo que se eligió. */
  name: string;
}

/** A los `atMs` de la canción hace `action`. Con `lengthMs`, al terminar lo
 *  deshace: el estrobo y el apagón se quitan, el effect se detiene y el color
 *  se suelta. */
export interface TimelineCue {
  id: string;
  atMs: number;
  lengthMs: number | null;
  action: Action;
}
