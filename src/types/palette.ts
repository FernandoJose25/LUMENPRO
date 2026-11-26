/**
 * Paleta: una posición, un color o un gobo con nombre ("Pista", "Mesa
 * principal"), con los valores de cada luz. Las escenas que la usan guardan a
 * qué paleta apuntan (Scene.refs): si se corrige, cambian todas.
 */
export type PaletteKind = "position" | "color" | "beam";

export const PALETTE_KIND_LABELS: Record<PaletteKind, string> = {
  position: "Posiciones",
  color: "Colores",
  beam: "Gobos y haz",
};

export interface Palette {
  id: string;
  name: string;
  kind: PaletteKind;
  /** instanceId -> channelId -> valor DMX */
  values: Record<string, Record<string, number>>;
  /** Colores creados desde un color: las luces que se agreguen después lo
   *  toman igual. */
  hex?: string;
}
