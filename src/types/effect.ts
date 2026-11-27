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
export type WaveformType = "sine" | "square" | "sawtooth" | "triangle" | "pulse" | "random";

export const WAVEFORM_LABELS: Record<WaveformType, string> = {
  sine: "Seno",
  square: "Cuadrada",
  sawtooth: "Diente de sierra",
  triangle: "Triangular",
  pulse: "Golpe",
  random: "Al azar (cada luz prende o apaga)",
};

/** Qué marca el paso: la velocidad propia, el ritmo de la música, o cuánto
 *  suena una parte de ella. Sin música (lib/audioInput.ts) todos vuelven a la
 *  velocidad propia. */
export type EffectSource = "clock" | "beat" | "bass" | "mid" | "treble";

export const EFFECT_SOURCE_LABELS: Record<EffectSource, string> = {
  clock: "Tiempo fijo",
  beat: "Ritmo",
  bass: "Graves",
  mid: "Medios",
  treble: "Agudos",
};

/** Una onda sobre un canal, o una figura que dibujan las cabezas alrededor de
 *  donde estén apuntando (sin tocar sus faders: se puede mover el centro). */
export type EffectKind = "wave" | "figure" | "pixels";

/** Lo que dibujan los puntos de una barra o tira de LEDs (show-engine,
 *  `PixelPattern`). */
export type PixelPattern =
  | "rainbow"
  | "chase"
  | "sparkle"
  | "meter"
  | "fill"
  | "bounce"
  | "alternate"
  | "halves"
  | "fire"
  | "confetti"
  | "colorCycle"
  | "jump"
  | "center"
  | "cutter"
  | "lightning"
  | "flash"
  | "wipe";

export const PIXEL_LABELS: Record<PixelPattern, string> = {
  rainbow: "Arcoíris que corre",
  chase: "Un punto que corre, con estela",
  sparkle: "Destellos al azar",
  meter: "Vúmetro (se llena con lo que suena)",
  fill: "Se llena y se vacía",
  bounce: "Un punto que va y vuelve",
  alternate: "Uno sí y uno no, dos colores",
  halves: "Mitad y mitad, dos colores (policía)",
  fire: "Fuego",
  confetti: "Confeti de colores",
  colorCycle: "Todos pasan por los colores",
  jump: "Todos saltan de color",
  center: "Se abre desde el centro",
  cutter: "Cortadora (un segmento a la vez)",
  lightning: "Relámpagos",
  flash: "Flash de todos juntos",
  wipe: "Barrido de color",
};

/** Los dibujos que usan el color elegido, y los que además usan un segundo. */
export const PIXEL_USES_COLOR: PixelPattern[] = [
  "chase", "sparkle", "fill", "bounce", "alternate", "halves", "center", "cutter", "lightning", "flash", "wipe",
];
export const PIXEL_USES_COLOR2: PixelPattern[] = ["alternate", "halves", "wipe"];

export type FigureType = "circle" | "eight" | "line" | "fan" | "square" | "diamond" | "triangle" | "random";

export const FIGURE_LABELS: Record<FigureType, string> = {
  circle: "Círculo",
  eight: "Ocho",
  line: "Línea",
  fan: "Abanico",
  square: "Cuadrado",
  diamond: "Rombo",
  triangle: "Triángulo",
  random: "Al azar (ballyhoo)",
};

export interface Effect {
  id: string;
  name: string;
  kind: EffectKind;
  figure: FigureType;
  /** Figuras: cuánto se aparta del centro, en grados. */
  sizeDeg: number;
  /** Figuras: giro del dibujo, en grados. */
  angleDeg: number;
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
  source: EffectSource;
  /** Con source "beat": golpes que dura cada ciclo. */
  beatsPerCycle: number;
  /** Píxeles: qué dibujan (arcoíris si falta). */
  pattern?: PixelPattern;
  /** Píxeles: el color del punto, los destellos o el llenado ("#rrggbb"). */
  color?: string | null;
  /** Píxeles: el otro color de los que alternan; sin él, apagado. */
  color2?: string | null;
  createdAt: number;
  updatedAt: number;
}
