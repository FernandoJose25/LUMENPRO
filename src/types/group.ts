/**
 * Fase 4 — Groups: una agrupación con nombre de instancias de fixtures.
 * Sirve como base para que Scenes/Chases/Effects puedan apuntar a "todos
 * los PARs" en vez de tener que seleccionar fixture por fixture.
 *
 * Diseño: un fixture pertenece a como máximo un grupo (mismo modelo que
 * ya insinuaba `FixtureInstance.group?: string` en types/fixture.ts,
 * ahora ese campo pasa a guardar el `Group.id`, no un nombre libre —
 * así renombrar un grupo no rompe la asignación de sus fixtures).
 */
export interface Group {
  id: string;
  name: string;
  /** Color de acento para identificar el grupo de un vistazo en la UI
   *  (franja del Button, indicador junto al fixture en Fixture Manager). */
  color: string;
}

export const GROUP_COLORS = [
  "#f97316", // naranja
  "#3b82f6", // azul
  "#22c55e", // verde
  "#eab308", // amarillo
  "#ec4899", // rosa
  "#8b5cf6", // violeta
  "#06b6d4", // cian
  "#ef4444", // rojo
] as const;
