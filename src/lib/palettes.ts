import type { ChannelValues } from "@/lib/fade";
import { colorValues, SWATCHES, takesColor } from "@/lib/look";
import type { ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Group } from "@/types/group";
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

const definitionOf = (rig: Pick<Rig, "definitions">, instance: FixtureInstance) =>
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
export function colorPaletteValues(rig: Pick<Rig, "instances" | "definitions">, hex: string): ChannelValues {
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

/** Un color de un toque y lo que pone en cada luz que puede ponerlo. */
export interface QuickColor {
  hex: string;
  name: string;
  values: ChannelValues;
}

/** Los colores fijos que el motor ofrece (ver `Show::held` en show-engine). */
export const quickColors = (rig: Pick<Rig, "instances" | "definitions">): QuickColor[] =>
  SWATCHES.map(({ name, hex }) => ({ hex, name, values: colorPaletteValues(rig, hex) }));

interface GroupedRig {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  groups: Group[];
}

/** El grupo de una luz para el color fijo: "" si no tiene o ya no existe. */
const colorKey = (rig: GroupedRig, instance: FixtureInstance) =>
  instance.group && rig.groups.some((g) => g.id === instance.group) ? instance.group : "";

/** Las luces de esa fila ("" = sin grupo) que pueden ponerse un color. */
export const colorMembers = (rig: GroupedRig, key: string) =>
  rig.instances.filter((i) => {
    const definition = definitionOf(rig, i);
    return colorKey(rig, i) === key && definition !== undefined && takesColor(definition);
  });

/** El color de la lista que tiene esa escena en esa fila, si lo tiene. */
export function sceneColor(rig: GroupedRig, values: ChannelValues, key: string): string | null {
  const members = colorMembers(rig, key);
  if (members.length === 0) return null;
  // Lo que la escena no tiene sale con su valor inicial.
  const match = SWATCHES.find(({ hex }) =>
    members.every((i) => {
      const definition = definitionOf(rig, i)!;
      return Object.entries(colorValues(definition, hex)).every(
        ([channelId, v]) =>
          (values[i.id]?.[channelId] ?? definition.channels.find((c) => c.id === channelId)?.defaultValue) === v,
      );
    }),
  );
  return match?.hex ?? null;
}

/** Los grupos que pueden tomar un color fijo, igual que `Show::color_rows`. */
export function colorRows(rig: GroupedRig): { id: string; name: string }[] {
  const keys = new Set(
    rig.instances
      .filter((i) => {
        const definition = definitionOf(rig, i);
        return definition && takesColor(definition);
      })
      .map((i) => colorKey(rig, i)),
  );
  const rows = rig.groups.filter((g) => keys.has(g.id)).map((g) => ({ id: g.id, name: g.name }));
  return keys.has("") ? [...rows, { id: "", name: "Sin grupo" }] : rows;
}

/** Lo que pone el color fijo en cada luz, igual que `Show::held`. */
export function heldValues(rig: GroupedRig, heldColors: Record<string, string>): ChannelValues {
  const values: ChannelValues = {};
  if (Object.keys(heldColors).length === 0) return values;
  for (const instance of rig.instances) {
    const hex = heldColors[colorKey(rig, instance)];
    const definition = definitionOf(rig, instance);
    if (hex && definition && takesColor(definition) && SWATCHES.some((s) => s.hex === hex)) {
      values[instance.id] = colorValues(definition, hex);
    }
  }
  return values;
}
