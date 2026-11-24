import type { ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";

export const DMX_CHANNELS = 512;

/** El motor en Rust maneja un solo universo (ver AUDIT.md §8.3). */
const OUTPUT_UNIVERSE = 1;

interface FrameInput {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  liveValues: Record<string, Record<string, number>>;
  blackoutActive: boolean;
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

/** Los 512 canales tal como salen por el cable (índice 0 = canal DMX 1). */
export function buildFrame({ instances, definitions, liveValues, blackoutActive }: FrameInput): number[] {
  const frame = new Array<number>(DMX_CHANNELS).fill(0);

  for (const instance of instances) {
    if (instance.universe !== OUTPUT_UNIVERSE) continue;
    const definition = definitions.find((d) => d.id === instance.definitionId);
    if (!definition) continue;

    for (const channel of definition.channels) {
      const address = instance.address + channel.index - 1;
      if (address < 1 || address > DMX_CHANNELS) continue;

      const value =
        blackoutActive && goesDarkOnBlackout(channel, definition)
          ? 0
          : (liveValues[instance.id]?.[channel.id] ?? channel.defaultValue);
      const output = channel.invert ? channel.dmxMin + channel.dmxMax - value : value;
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
