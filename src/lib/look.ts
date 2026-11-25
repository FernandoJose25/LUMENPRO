import type { ChannelValues } from "@/lib/fade";
import { isSubtractive } from "@/lib/dmxFrame";
import type { ChannelPreset, ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";

/** Valores por tipo de canal, sin importar en qué número esté en cada equipo. */
export type Look = Partial<Record<ChannelType, number>>;

export function lookValues(
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
  look: Look,
): ChannelValues {
  return Object.fromEntries(
    instances.map((instance) => {
      const channels = definitions.find((d) => d.id === instance.definitionId)?.channels ?? [];
      return [
        instance.id,
        Object.fromEntries(
          channels.flatMap((c) => {
            const value = look[c.type];
            return value === undefined ? [] : [[c.id, value] as const];
          }),
        ),
      ];
    }),
  );
}

export const SWATCHES = [
  { name: "Blanco", hex: "#ffffff" },
  { name: "Ámbar", hex: "#ff6e14" },
  { name: "Dorado", hex: "#ffa01e" },
  { name: "Rojo", hex: "#ff0000" },
  { name: "Rosa", hex: "#ff3c8c" },
  { name: "Magenta", hex: "#ff00ff" },
  { name: "Violeta", hex: "#7800ff" },
  { name: "Azul", hex: "#0000ff" },
  { name: "Cian", hex: "#00ffff" },
  { name: "Verde", hex: "#00ff00" },
  { name: "Amarillo", hex: "#ffff00" },
] as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Cuánto de rojo, verde y azul pone cada LED, para mostrarlo en pantalla. */
export const EMITTER_RGB: Partial<Record<ChannelType, [number, number, number]>> = {
  RED: [255, 0, 0],
  GREEN: [0, 255, 0],
  BLUE: [0, 0, 255],
  WHITE: [255, 255, 255],
  AMBER: [255, 126, 0],
  UV: [148, 0, 211],
  LIME: [173, 255, 47],
  INDIGO: [75, 0, 130],
  CYAN: [0, 255, 255],
  MAGENTA: [255, 0, 255],
  YELLOW: [255, 255, 0],
};

function hueSaturation([r, g, b]: [number, number, number]): { hue: number; saturation: number } {
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max === min) return { hue: 0, saturation: 0 };
  const span = max - min;
  const sector = max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return { hue: sector / 6, saturation: span / max };
}

/** El preset de color más parecido de una rueda o de un canal de colores. */
function nearestColor(channel: FixtureChannel, rgb: [number, number, number]): ChannelPreset | undefined {
  let best: { preset: ChannelPreset; distance: number } | undefined;
  for (const preset of channel.presets) {
    if (!preset.color || preset.color2) continue;
    const distance = hexToRgb(preset.color).reduce((sum, v, i) => sum + (v - rgb[i]) ** 2, 0);
    if (!best || distance < best.distance) best = { preset, distance };
  }
  return best?.preset;
}

const find = (definition: FixtureDefinition, type: ChannelType) => definition.channels.find((c) => c.type === type);

/** La rueda de color, o el canal de colores de un equipo que no mezcla. */
export function colorChannel(definition: FixtureDefinition): FixtureChannel | undefined {
  return definition.channels.find(
    (c) => (c.type === "COLOR_WHEEL" || c.type === "COLOR") && c.presets.some((p) => p.color),
  );
}

export const takesColor = (definition: FixtureDefinition) =>
  (["RED", "HUE"] as ChannelType[]).some((type) => find(definition, type)) ||
  isSubtractive(definition) ||
  colorChannel(definition) !== undefined;

/**
 * Valores de canal para poner ese color, según cómo lo haga el equipo: LED,
 * filtros CMY, tono y saturación, o la rueda (el color más cercano). MODE y los
 * colores automáticos a 0: en un programa automático el PAR ignora el RGB. El
 * LED blanco solo suma en el blanco puro y los demás LED quedan apagados: en
 * otro color lo lavarían.
 */
export function colorValues(definition: FixtureDefinition, hex: string): Record<string, number> {
  const rgb = hexToRgb(hex);
  const [red, green, blue] = rgb;
  const { hue, saturation } = hueSaturation(rgb);
  const mixes = find(definition, "RED") !== undefined || find(definition, "HUE") !== undefined || isSubtractive(definition);
  const look: Look = {
    RED: red,
    GREEN: green,
    BLUE: blue,
    WHITE: hex === "#ffffff" ? 255 : 0,
    AMBER: 0,
    UV: 0,
    LIME: 0,
    INDIGO: 0,
    HUE: Math.round(hue * 255),
    SATURATION: Math.round(saturation * 255),
    MODE: 0,
    ...(isSubtractive(definition)
      ? { CYAN: 255 - red, MAGENTA: 255 - green, YELLOW: 255 - blue }
      : { CYAN: 0, MAGENTA: 0, YELLOW: 0 }),
  };
  const values: Record<string, number> = {};
  const wheel = mixes ? undefined : colorChannel(definition);
  for (const channel of definition.channels) {
    const value = look[channel.type];
    if (value !== undefined) values[channel.id] = value;
    else if (mixes && (channel.type === "COLOR" || channel.type === "COLOR_WHEEL")) {
      values[channel.id] = channel.defaultValue;
    }
  }
  const preset = wheel && nearestColor(wheel, rgb);
  if (wheel && preset) values[wheel.id] = Math.round((preset.dmxFrom + preset.dmxTo) / 2);
  return values;
}
