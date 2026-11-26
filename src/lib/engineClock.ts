import type { TimelineRun } from "@/types/engine";

/**
 * La hora del motor. Arranca con la de Windows pero no la sigue si Windows la
 * corrige a mitad del evento (src-tauri/src/engine/mod.rs, `Clock`): para
 * poner la canción donde va, la ventana usa la que el motor dice tener.
 */
let offset = 0;

export function noteEngineNow(now: number | undefined): void {
  if (now) offset = now - Date.now();
}

export function engineNow(): number {
  return Date.now() + offset;
}

/** Por dónde va la canción, en ms. */
export function positionOf(run: TimelineRun, now = engineNow()): number {
  return run.pausedAt ?? now - run.startedAt;
}
