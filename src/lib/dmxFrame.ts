import type { ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";

export const DMX_CHANNELS = 512;

/** El motor en Rust maneja un solo universo (ver AUDIT.md §8.3). */
const OUTPUT_UNIVERSE = 1;

export interface FrameInput {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  liveValues: Record<string, Record<string, number>>;
  blackoutActive: boolean;
  /** Intensidad general, 0–100. */
  master: number;
  strobeActive: boolean;
  /** Fixture encendido a pleno para reconocerlo, o null. */
  identifyId: string | null;
}

/** Canales que emiten luz. MODE entra porque un PAR en programa automático
 *  puede ignorar el dimmer. Pan/Tilt, gobos, color, foco y MACRO (reset,
 *  lámpara) quedan fuera a propósito: llevarlos a 0 movería las cabezas. */
const LIGHT_TYPES: ChannelType[] = ["DIMMER", "RED", "GREEN", "BLUE", "WHITE", "MODE"];

function goesDarkOnBlackout(channel: FixtureChannel, definition: FixtureDefinition): boolean {
  if (LIGHT_TYPES.includes(channel.type)) return true;
  // Sin dimmer ni RGBW, cerrar el shutter es la única forma de apagarlo.
  return channel.type === "STROBE" && !definition.channels.some((c) => LIGHT_TYPES.includes(c.type));
}

const COLOR_TYPES: ChannelType[] = ["RED", "GREEN", "BLUE", "WHITE"];

/** La intensidad general baja el dimmer; sin dimmer, los colores. */
function followsMaster(channel: FixtureChannel, definition: FixtureDefinition): boolean {
  if (channel.type === "DIMMER") return true;
  return COLOR_TYPES.includes(channel.type) && !definition.channels.some((c) => c.type === "DIMMER");
}

/** Valor para el botón Estrobo, o null si no se sabe cuál es. En una cabeza
 *  sin rango conocido no se adivina: podría caer en "cerrado". En un PAR lo
 *  habitual es lento a rápido en todo el canal. */
function strobeValue(channel: FixtureChannel, definition: FixtureDefinition): number | null {
  const range = channel.presets.find((p) => p.label === "Estrobo");
  if (range) return range.dmxFrom + (range.dmxTo - range.dmxFrom) * 0.75;
  return definition.channels.some((c) => c.type === "PAN") ? null : 200;
}

/** Lo que vale un canal una vez aplicados intensidad, estrobo, identificar y
 *  Blackout. Antes de invertir: es lo que ve el simulador. */
export function effectiveValue(
  instance: FixtureInstance,
  definition: FixtureDefinition,
  channel: FixtureChannel,
  input: FrameInput,
): number {
  let value = input.liveValues[instance.id]?.[channel.id] ?? channel.defaultValue;
  if (input.strobeActive && channel.type === "STROBE") value = strobeValue(channel, definition) ?? value;
  if (followsMaster(channel, definition)) value = (value * input.master) / 100;
  if (input.identifyId === instance.id) {
    if (channel.type === "DIMMER" || COLOR_TYPES.includes(channel.type)) value = 255;
    if (channel.type === "MODE") value = 0;
    if (channel.type === "STROBE") value = channel.defaultValue;
  }
  if (input.blackoutActive && goesDarkOnBlackout(channel, definition)) value = 0;
  return value;
}

function isInverted(instance: FixtureInstance, channel: FixtureChannel): boolean {
  const byMount =
    (instance.panInvert === true && (channel.type === "PAN" || channel.type === "PAN_FINE")) ||
    (instance.tiltInvert === true && (channel.type === "TILT" || channel.type === "TILT_FINE"));
  return channel.invert !== byMount;
}

/** Los 512 canales tal como salen por el cable (índice 0 = canal DMX 1). */
export function buildFrame(input: FrameInput): number[] {
  const frame = new Array<number>(DMX_CHANNELS).fill(0);

  for (const instance of input.instances) {
    if (instance.universe !== OUTPUT_UNIVERSE) continue;
    const definition = input.definitions.find((d) => d.id === instance.definitionId);
    if (!definition) continue;

    for (const channel of definition.channels) {
      const address = instance.address + channel.index - 1;
      if (address < 1 || address > DMX_CHANNELS) continue;

      const value = effectiveValue(instance, definition, channel, input);
      const output = isInverted(instance, channel) ? channel.dmxMin + channel.dmxMax - value : value;
      frame[address - 1] = Math.max(0, Math.min(255, Math.round(output)));
    }
  }

  return frame;
}

export interface PatchRow {
  instance: FixtureInstance;
  first: number;
  last: number;
  /** Problemas de direccionamiento, en texto listo para mostrar. */
  issues: string[];
}

/** Qué canales ocupa cada fixture, en orden de dirección, con los choques. */
export function describePatch(instances: FixtureInstance[], definitions: FixtureDefinition[]): PatchRow[] {
  const rows = instances
    .map((instance): PatchRow => {
      // El número más alto y no la cantidad: un perfil puede tener huecos.
      const channels = definitions.find((d) => d.id === instance.definitionId)?.channels ?? [];
      const count = Math.max(0, ...channels.map((c) => c.index));
      return { instance, first: instance.address, last: instance.address + count - 1, issues: [] };
    })
    .sort((a, b) => a.instance.universe - b.instance.universe || a.first - b.first);

  for (const row of rows) {
    if (row.instance.universe !== OUTPUT_UNIVERSE) {
      row.issues.push(`Universo ${row.instance.universe}: solo se envía el universo ${OUTPUT_UNIVERSE}`);
    }
    if (row.last > DMX_CHANNELS) row.issues.push(`Se pasa del canal ${DMX_CHANNELS}`);
    for (const other of rows) {
      const overlaps =
        other !== row &&
        other.instance.universe === row.instance.universe &&
        other.first <= row.last &&
        row.first <= other.last;
      if (overlaps) row.issues.push(`Se pisa con ${other.instance.label} (${other.first}–${other.last})`);
    }
  }

  return rows;
}

/** Primera dirección donde entran `count` canales seguidos sin pisar a nadie;
 *  1 si ya no queda lugar. */
export function nextFreeAddress(
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
  count: number,
): number {
  let address = 1;
  for (const row of describePatch(instances, definitions)) {
    if (row.instance.universe !== OUTPUT_UNIVERSE) continue;
    if (address + count - 1 < row.first) break;
    address = Math.max(address, row.last + 1);
  }
  return address + count - 1 <= DMX_CHANNELS ? address : 1;
}
