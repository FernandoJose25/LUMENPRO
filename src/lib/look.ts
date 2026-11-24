import type { ChannelValues } from "@/lib/fade";
import type { ChannelType, FixtureDefinition, FixtureInstance } from "@/types/fixture";

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

/** MODE a 0: en un programa automático el PAR ignora el RGB manual. El LED
 *  blanco solo suma en el blanco puro; en los demás lavaría el color. */
export function colorLook(hex: string): Look {
  const [RED, GREEN, BLUE] = hexToRgb(hex);
  return { RED, GREEN, BLUE, WHITE: hex === "#ffffff" ? 255 : 0, MODE: 0 };
}
