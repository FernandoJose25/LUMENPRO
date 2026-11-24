import type { ChannelType, FixtureDefinition } from "@/types/fixture";

/** instanceId -> channelId -> valor DMX, la misma forma que Scene.values. */
export type ChannelValues = Record<string, Record<string, number>>;

const FADEABLE: ChannelType[] = [
  "DIMMER",
  "RED",
  "GREEN",
  "BLUE",
  "WHITE",
  "PAN",
  "PAN_FINE",
  "TILT",
  "TILT_FINE",
  "ZOOM",
  "FOCUS",
  "FROST",
];

/** Canales por rangos (estrobo, gobo, rueda de color, macros…): interpolarlos
 *  haría pasar la luz por todo lo que hay en medio — de shutter abierto a
 *  cerrado cruzaría todas las velocidades de estrobo. Saltan al empezar. */
export function snapChannelIds(definitions: FixtureDefinition[]): Set<string> {
  return new Set(
    definitions.flatMap((d) => d.channels.filter((c) => !FADEABLE.includes(c.type)).map((c) => c.id)),
  );
}

export function fadeValue(from: number, to: number, t: number, snap: boolean): number {
  return snap ? to : Math.round(from + (to - from) * t);
}
