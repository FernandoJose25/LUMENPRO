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
  | "AMBER"
  | "UV"
  | "LIME"
  | "INDIGO"
  | "CYAN"
  | "MAGENTA"
  | "YELLOW"
  | "HUE"
  | "SATURATION"
  | "CTO"
  | "GOBO"
  | "GOBO_ROT"
  | "PRISM"
  | "PRISM_ROT"
  | "FROST"
  | "ZOOM"
  | "FOCUS"
  | "IRIS"
  | "STROBE"
  | "SPEED"
  | "MODE"
  | "MACRO"
  | "FINE"
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
  AMBER: "Ámbar",
  UV: "UV",
  LIME: "Lima",
  INDIGO: "Índigo",
  CYAN: "Cian",
  MAGENTA: "Magenta",
  YELLOW: "Amarillo",
  HUE: "Tono",
  SATURATION: "Saturación",
  CTO: "Temperatura de color",
  GOBO: "Gobo",
  GOBO_ROT: "Gobo Rot",
  PRISM: "Prism",
  PRISM_ROT: "Prism Rot",
  FROST: "Frost",
  ZOOM: "Zoom",
  FOCUS: "Focus",
  IRIS: "Iris",
  STROBE: "Strobe",
  SPEED: "Speed",
  MODE: "Mode",
  MACRO: "Macro",
  FINE: "Fino (16 bits)",
  OTHER: "Otro",
};

/** Qué hace un rango, cuando se sabe: lo usan el simulador, el botón Estrobo y
 *  la pantalla de control. */
export type PresetKind =
  | "open"
  | "closed"
  | "strobe"
  | "pulse"
  | "shake"
  | "cw"
  | "ccw"
  | "stop"
  | "prism"
  | "off"
  | "lamp"
  | "reset";

/** Preset de un rango de valores dentro de un canal (p. ej. "Azul" = 60-79). */
export interface ChannelPreset {
  id: string;
  label: string;
  dmxFrom: number;
  dmxTo: number;
  kind?: PresetKind;
  /** Color con el que se ve en el simulador (rueda de color), en hex. */
  color?: string;
  /** Segundo color, en los que son mitad y mitad. */
  color2?: string;
  /** Imagen dentro de public/gobos. */
  gobo?: string;
  /** Caras del prisma. */
  facets?: number;
}

/** Dónde está el equipo en el escenario, para el simulador. Metros y grados;
 *  x a la derecha, y hacia arriba, z hacia el público. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Giro sobre el eje vertical. 0 = mirando al público. */
  yaw: number;
  /** Inclinación de un equipo fijo: 90 = techo, 0 = al frente, -90 = piso. */
  pitch: number;
  /** Cabeza colgada de un truss en vez de apoyada. */
  hung: boolean;
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
  /** En un canal fino, el id del canal que completa a 16 bits. */
  fineOf?: string;
  /** Dimmer general de un equipo que además tiene dimmers por foco. */
  master?: boolean;
  /** Zoom que va de abierto a cerrado, o iris de cerrado a abierto. */
  reversed?: boolean;
}

/** Sección 9 — perfil de fixture (fabricante, modelo, canales, límites pan/tilt...). */
export interface FixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  channels: FixtureChannel[];
  panLimit?: { min: number; max: number };
  tiltLimit?: { min: number; max: number };
  /** Modo del menú del equipo ("7 Channel"). */
  mode?: string;
  /** Tipo de equipo según QLC+ ("Moving Head", "Smoke"…). */
  kind?: string;
  /** Barras y equipos de varios focos: los ids de canal de cada uno. */
  heads?: string[][];
  /** Apertura del haz, en grados. */
  lens?: { min: number; max: number };
  /** Metros. */
  width?: number;
  /** Columnas y filas de focos. */
  grid?: [number, number];
  /** De dónde salió, si es de la biblioteca: permite cambiar de modo. */
  library?: { maker: string; model: string };
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
  /** Invierten el movimiento en la salida, para que la cabeza real coincida
   *  con el simulador según cómo esté montada. */
  panInvert?: boolean;
  tiltInvert?: boolean;
  placement?: Placement;
}
