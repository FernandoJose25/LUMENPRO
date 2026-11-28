import type { Moment } from "@/types/moment";

/** Piloto automático: entre qué momentos elige según cómo suena la música
 *  (show-engine: `tick_autopilot`). */
export interface Autopilot {
  calm: string[];
  normal: string[];
  intense: string[];
}

export const INTENSITIES = [
  { id: "calm", level: -1, name: "Calmada", hint: "voces, partes suaves", color: "#3ba7ff" },
  { id: "normal", level: 0, name: "Normal", hint: "la canción de siempre", color: "#ffb020" },
  { id: "intense", level: 1, name: "Intensa", hint: "el coro, cuando revienta", color: "#ff3b5c" },
] as const;

export const intensityOf = (level: -1 | 0 | 1) => INTENSITIES.find((i) => i.level === level)!;

/** Sin elegir todavía: los de la plantilla de quinceañera, por su nombre. */
export function autopilotOf(doc: { autopilot?: Autopilot; moments: Moment[] }): Autopilot {
  if (doc.autopilot) return doc.autopilot;
  const named = (name: string) => doc.moments.filter((m) => m.name.toLowerCase() === name).map((m) => m.id);
  return { calm: named("hora loca"), normal: named("hora loca con música"), intense: named("hora loca + estrobo") };
}
