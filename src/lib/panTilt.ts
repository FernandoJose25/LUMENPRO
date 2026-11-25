import type { ChannelType, FixtureChannel, FixtureDefinition } from "@/types/fixture";

type Axis = "PAN" | "TILT";
const FINE: Record<Axis, ChannelType> = { PAN: "PAN_FINE", TILT: "TILT_FINE" };

const find = (definition: FixtureDefinition, type: ChannelType) => definition.channels.find((c) => c.type === type);

function fineOf(definition: FixtureDefinition, coarse: FixtureChannel, axis: Axis): FixtureChannel | undefined {
  return (
    definition.channels.find((c) => c.fineOf === coarse.id) ??
    definition.channels.find((c) => c.type === FINE[axis] && !c.fineOf)
  );
}

export const hasPanTilt = (definition: FixtureDefinition) =>
  find(definition, "PAN") !== undefined && find(definition, "TILT") !== undefined;

/** Recorrido del canal en pasos: con canal fino son 256 por cada valor DMX. */
function steps(coarse: FixtureChannel, fine: FixtureChannel | undefined): number {
  const range = coarse.dmxMax - coarse.dmxMin;
  return Math.max(1, fine ? range * 256 + 255 : range);
}

/** Posición del eje de 0 a 1, juntando el canal fino si lo tiene. */
export function readAxis(
  definition: FixtureDefinition,
  axis: Axis,
  valueOf: (channel: FixtureChannel) => number,
): number {
  const coarse = find(definition, axis);
  if (!coarse) return 0;
  const fine = fineOf(definition, coarse, axis);
  const value = valueOf(coarse) - coarse.dmxMin;
  return (fine ? value * 256 + valueOf(fine) : value) / steps(coarse, fine);
}

/** Valores de canal para llevar el eje a esa posición. */
export function writeAxis(definition: FixtureDefinition, axis: Axis, position: number): Record<string, number> {
  const values: Record<string, number> = {};
  // Los equipos de varias cabezas las apuntan todas igual.
  for (const coarse of definition.channels.filter((c) => c.type === axis)) {
    const fine = fineOf(definition, coarse, axis);
    const step = Math.round(Math.max(0, Math.min(1, position)) * steps(coarse, fine));
    values[coarse.id] = coarse.dmxMin + (fine ? Math.floor(step / 256) : step);
    if (fine) values[fine.id] = step % 256;
  }
  return values;
}
