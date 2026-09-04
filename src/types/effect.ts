import type { ChannelType } from "@/types/fixture";

/**
 * Fase 4 — Effects: a diferencia de un Chase (que salta entre valores
 * fijos de escenas guardadas), un Effect genera valores continuamente
 * a partir de una función de onda — sube y baja el Dimmer en seno, hace
 * parpadear un Strobe en cuadrada, etc. — sin necesitar escenas previas.
 *
 * Un Effect apunta siempre a un Group (types/group.ts) y a un tipo de
 * canal (`ChannelType`, no un canal fijo — cada fixture del grupo puede
 * tener ese tipo de canal en un índice DMX distinto, igual que
 * `setGroupChannelByType` en fixtureStore).
 */
export type WaveformType = "sine" | "square" | "sawtooth" | "triangle";

export const WAVEFORM_LABELS: Record<WaveformType, string> = {
  sine: "Seno",
  square: "Cuadrada",
  sawtooth: "Diente de sierra",
  triangle: "Triangular",
};

export interface Effect {
  id: string;
  name: string;
  /** Group.id objetivo. Un efecto sin grupo asignado no hace nada al
   *  reproducirse (la UI no debería dejar "Reproducir" sin uno). */
  groupId: string | null;
  channelType: ChannelType;
  waveform: WaveformType;
  /** Velocidad en ciclos por minuto — más intuitivo para iluminación que Hz. */
  speedCpm: number;
  min: number;
  max: number;
  /** Desfase entre fixtures consecutivos del grupo, en grados (0-360).
   *  0 = todos los fixtures sincronizados; >0 crea un efecto de "ola"
   *  recorriendo el grupo (p. ej. 6 fixtures con 60° = una vuelta
   *  completa repartida entre todos). */
  phaseOffsetDeg: number;
  createdAt: number;
  updatedAt: number;
}
