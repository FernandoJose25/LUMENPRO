/** Tipo de atributo de un canal DMX — sección 10, tabla CHANNEL/ATTRIBUTE del brief. */
export type ChannelType =
  | "PAN"
  | "PAN_FINE"
  | "TILT"
  | "TILT_FINE"
  | "DIMMER"
  | "COLOR"
  | "COLOR_WHEEL"
  | "RED"
  | "GREEN"
  | "BLUE"
  | "WHITE"
  | "GOBO"
  | "GOBO_ROT"
  | "PRISM"
  | "PRISM_ROT"
  | "FROST"
  | "ZOOM"
  | "FOCUS"
  | "STROBE"
  | "SPEED"
  | "MODE"
  | "MACRO"
  | "OTHER";

export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  PAN: "Pan",
  PAN_FINE: "Pan Fine",
  TILT: "Tilt",
  TILT_FINE: "Tilt Fine",
  DIMMER: "Dimmer",
  COLOR: "Color",
  COLOR_WHEEL: "Color Wheel",
  RED: "Red",
  GREEN: "Green",
  BLUE: "Blue",
  WHITE: "White",
  GOBO: "Gobo",
  GOBO_ROT: "Gobo Rot",
  PRISM: "Prism",
  PRISM_ROT: "Prism Rot",
  FROST: "Frost",
  ZOOM: "Zoom",
  FOCUS: "Focus",
  STROBE: "Strobe",
  SPEED: "Speed",
  MODE: "Mode",
  MACRO: "Macro",
  OTHER: "Otro",
};

/** Preset de un rango de valores dentro de un canal (p. ej. "Azul" = 60-79). */
export interface ChannelPreset {
  id: string;
  label: string;
  dmxFrom: number;
  dmxTo: number;
}

/** Sección 10 — cada canal debe permitir: nombre, tipo, rango DMX, presets,
 *  inversión, curvas, min/max, funciones especiales. */
export interface FixtureChannel {
  id: string;
  index: number;
  name: string;
  type: ChannelType;
  dmxMin: number;
  dmxMax: number;
  defaultValue: number;
  invert: boolean;
  curve: "linear" | "log" | "s-curve";
  presets: ChannelPreset[];
  notes?: string;
}

/** Sección 9 — perfil de fixture (fabricante, modelo, canales, límites pan/tilt...). */
export interface FixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  channels: FixtureChannel[];
  panLimit?: { min: number; max: number };
  tiltLimit?: { min: number; max: number };
  /** false = plantilla genérica sin verificar contra la hoja oficial o la consola física. */
  verified: boolean;
  verifiedNote?: string;
}

/** Una unidad física patcheada — sección 9 (DMX Address, Universe, Mode). */
export interface FixtureInstance {
  id: string;
  definitionId: string;
  label: string;
  universe: number;
  address: number;
  mode?: string;
  /** Group.id (types/group.ts) al que pertenece este fixture, o undefined
   *  si no está agrupado. Antes era un string libre sin usar en ningún
   *  lado (Fase 4 lo activa) — ahora referencia siempre un Group real. */
  group?: string;
  panInvert?: boolean;
  tiltInvert?: boolean;
}
