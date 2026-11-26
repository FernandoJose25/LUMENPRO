import type { ChannelValues } from "@/lib/fade";
import { colorValues, takesColor } from "@/lib/look";
import type { ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Palette, PaletteKind } from "@/types/palette";

const KIND_TYPES: Record<PaletteKind, ChannelType[]> = {
  position: ["PAN", "PAN_FINE", "TILT", "TILT_FINE"],
  color: [
    "RED", "GREEN", "BLUE", "WHITE", "AMBER", "UV", "LIME", "INDIGO", "CYAN", "MAGENTA", "YELLOW",
    "HUE", "SATURATION", "CTO", "COLOR", "COLOR_WHEEL",
  ],
  beam: ["GOBO", "GOBO_ROT", "PRISM", "PRISM_ROT", "FROST", "FOCUS", "ZOOM", "IRIS"],
};

export const PALETTE_KINDS = Object.keys(KIND_TYPES) as PaletteKind[];

/** A qué clase de paleta pertenece un canal. Un fino va con el suyo. */
export function kindOf(channel: FixtureChannel, definition: FixtureDefinition): PaletteKind | null {
  const type =
    channel.type === "FINE" ? definition.channels.find((c) => c.id === channel.fineOf)?.type : channel.type;
  return PALETTE_KINDS.find((kind) => type && KIND_TYPES[kind].includes(type)) ?? null;
}

const channelsOf = (definition: FixtureDefinition | undefined, kind: PaletteKind) =>
  definition?.channels.filter((c) => kindOf(c, definition) === kind) ?? [];

interface Rig {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  liveValues: ChannelValues;
}

const definitionOf = (rig: Rig, instance: FixtureInstance) =>
  rig.definitions.find((d) => d.id === instance.definitionId);

/** Lo que tienen ahora esas luces en los canales de esa clase. */
export function capture(rig: Rig, kind: PaletteKind, instances: FixtureInstance[]): ChannelValues {
  const values: ChannelValues = {};
  for (const instance of instances) {
    const channels = channelsOf(definitionOf(rig, instance), kind);
    if (channels.length === 0) continue;
    values[instance.id] = Object.fromEntries(
      channels.map((c) => [c.id, rig.liveValues[instance.id]?.[c.id] ?? c.defaultValue]),
    );
  }
  return values;
}

/** Un color para todas las luces que puedan ponerlo, cada una a su manera. */
export function colorPaletteValues(rig: Rig, hex: string): ChannelValues {
  const values: ChannelValues = {};
  for (const instance of rig.instances) {
    const definition = definitionOf(rig, instance);
    if (definition && takesColor(definition)) values[instance.id] = colorValues(definition, hex);
  }
  return values;
}

/** Los valores de la paleta para esas luces (las que no tiene, nada). */
export function paletteValues(palette: Palette, rig: Rig, instances: FixtureInstance[]): ChannelValues {
  const values: ChannelValues = {};
  for (const instance of instances) {
    const own = palette.values[instance.id];
    const definition = definitionOf(rig, instance);
    // Una luz agregada después de crear un color también lo toma.
    if (own) values[instance.id] = own;
    else if (palette.hex && definition && takesColor(definition)) values[instance.id] = colorValues(definition, palette.hex);
  }
  return values;
}

/**
 * Qué paleta tiene puesta cada luz: la que coincide exactamente con lo que
 * está saliendo. Así una escena guardada sigue a la paleta si después se
 * corrige. Con dos iguales gana la última.
 */
export function matchPalettes(rig: Rig, palettes: Palette[]): Record<string, Partial<Record<PaletteKind, string>>> {
  const refs: Record<string, Partial<Record<PaletteKind, string>>> = {};
  for (const instance of rig.instances) {
    const definition = definitionOf(rig, instance);
    for (const palette of palettes) {
      const own = palette.values[instance.id];
      if (!own || Object.keys(own).length === 0) continue;
      const matches = Object.entries(own).every(([channelId, value]) => {
        const channel = definition?.channels.find((c) => c.id === channelId);
        return channel && (rig.liveValues[instance.id]?.[channelId] ?? channel.defaultValue) === value;
      });
      if (matches) refs[instance.id] = { ...refs[instance.id], [palette.kind]: palette.id };
    }
  }
  return refs;
}

/** Las luces que tienen algo de esa clase. */
export const instancesFor = (rig: Rig, kind: PaletteKind, instances = rig.instances) =>
  instances.filter((i) => channelsOf(definitionOf(rig, i), kind).length > 0);
