import type { ChannelType, FixtureChannel, FixtureDefinition, FixtureInstance } from "@/types/fixture";

export const DMX_CHANNELS = 512;

export interface FrameInput {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  liveValues: Record<string, Record<string, number>>;
  /** Cabezas dibujando una figura: mandan sobre liveValues. */
  moving?: Record<string, Record<string, number>>;
  /** Colores fijos: mandan sobre todo lo demás (ver palettes.ts, heldValues). */
  held?: Record<string, Record<string, number>>;
  blackoutActive: boolean;
  /** Intensidad general, 0–100. */
  master: number;
  strobeActive: boolean;
  /** Fixture encendido a pleno para reconocerlo, o null. */
  identifyId: string | null;
}

// Las mismas reglas que show-engine/src/model.rs y frame.rs.

const EMITTERS: ChannelType[] = ["RED", "GREEN", "BLUE", "WHITE", "AMBER", "UV", "LIME", "INDIGO"];
const CMY: ChannelType[] = ["CYAN", "MAGENTA", "YELLOW"];

const has = (definition: FixtureDefinition, type: ChannelType) => definition.channels.some((c) => c.type === type);

/** Con los tres y sin rojo son filtros: más valor, menos luz. */
export const isSubtractive = (definition: FixtureDefinition) =>
  CMY.every((type) => has(definition, type)) && !has(definition, "RED");

/** El canal es de un LED de color. */
export const emits = (type: ChannelType, definition: FixtureDefinition) =>
  EMITTERS.includes(type) || (CMY.includes(type) && !isSubtractive(definition));

const isLight = (type: ChannelType, definition: FixtureDefinition) =>
  type === "DIMMER" || type === "MODE" || type === "COLOR" || emits(type, definition);

/** Humo y ventiladores no son luces. */
export const givesLight = (definition: FixtureDefinition) => !["Smoke", "Hazer", "Fan"].includes(definition.kind ?? "");

function goesDarkOnBlackout(channel: FixtureChannel, definition: FixtureDefinition): boolean {
  if (isLight(channel.type, definition)) return true;
  // Sin dimmer ni color, cerrar el shutter es la única forma de apagarlo.
  return channel.type === "STROBE" && !definition.channels.some((c) => isLight(c.type, definition));
}

/** La intensidad general baja el dimmer; sin dimmer, los colores. */
function followsMaster(channel: FixtureChannel, definition: FixtureDefinition): boolean {
  if (!givesLight(definition)) return false;
  const dimmers = definition.channels.filter((c) => c.type === "DIMMER");
  if (dimmers.length === 0) return emits(channel.type, definition);
  if (channel.type !== "DIMMER") return false;
  if (dimmers.some((c) => c.master)) return channel.master === true;
  const inAHead = (c: FixtureChannel) => definition.heads?.some((head) => head.includes(c.id)) ?? false;
  return !inAHead(channel) || dimmers.every(inAHead);
}

/** Valor para el botón Estrobo, o null si no se sabe cuál es. En una cabeza
 *  sin rango conocido no se adivina: podría caer en "cerrado". En un PAR lo
 *  habitual es lento a rápido en todo el canal. */
function strobeValue(channel: FixtureChannel, definition: FixtureDefinition): number | null {
  const range = channel.presets.find((p) => p.label === "Estrobo" || p.kind === "strobe");
  if (range) return range.dmxFrom + (range.dmxTo - range.dmxFrom) * 0.75;
  return has(definition, "PAN") ? null : 200;
}

/** Solo lo que es cantidad de luz: en pan/tilt o en un canal por rangos una
 *  curva cambiaría a dónde apunta o qué hace. */
export function acceptsCurve(type: ChannelType): boolean {
  return type === "DIMMER" || EMITTERS.includes(type) || CMY.includes(type);
}

function applyCurve(channel: FixtureChannel, value: number): number {
  if (channel.curve === "linear" || !acceptsCurve(channel.type)) return value;
  const range = channel.dmxMax - channel.dmxMin;
  if (range <= 0) return value;
  const t = Math.max(0, Math.min(1, (value - channel.dmxMin) / range));
  const curved = channel.curve === "log" ? t * t : t * t * (3 - 2 * t);
  return channel.dmxMin + range * curved;
}

/** Lo que vale un canal una vez aplicados intensidad, estrobo, identificar y
 *  Blackout y la curva. Antes de invertir: es lo que ve el simulador. Lo que
 *  sale por el cable lo arma el motor (show-engine/src/frame.rs) con las
 *  mismas reglas; dmxFrame.test.ts comprueba que coincidan. */
export function effectiveValue(
  instance: FixtureInstance,
  definition: FixtureDefinition,
  channel: FixtureChannel,
  input: FrameInput,
): number {
  let value =
    input.held?.[instance.id]?.[channel.id] ??
    input.moving?.[instance.id]?.[channel.id] ??
    input.liveValues[instance.id]?.[channel.id] ??
    channel.defaultValue;
  if (input.strobeActive && channel.type === "STROBE") value = strobeValue(channel, definition) ?? value;
  if (followsMaster(channel, definition)) value = (value * input.master) / 100;
  if (input.identifyId === instance.id && givesLight(definition)) {
    if (channel.type === "DIMMER" || emits(channel.type, definition)) value = 255;
    if (channel.type === "MODE" || channel.type === "COLOR") value = 0;
    if (channel.type === "STROBE") value = channel.defaultValue;
  }
  if (input.blackoutActive && goesDarkOnBlackout(channel, definition)) return 0;
  return applyCurve(channel, value);
}

/** Mismo modelo en la misma dirección: el cable les manda lo mismo, así que
 *  van juntas (dos PAR en el 001). Igual que `Instance::twin_of`. */
export const isTwin = (a: FixtureInstance, b: FixtureInstance) =>
  a.universe === b.universe && a.address === b.address && a.definitionId === b.definitionId;

/** De las que van juntas, la que manda por el cable: la primera. */
export const outputOf = (instances: FixtureInstance[], instance: FixtureInstance) =>
  instances.find((other) => isTwin(other, instance)) ?? instance;

/** Lo que se le pone a una luz se le pone también a las que van con ella. */
export function withTwins(
  instances: FixtureInstance[],
  values: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out = { ...values };
  for (const [instanceId, channels] of Object.entries(values)) {
    const instance = instances.find((i) => i.id === instanceId);
    if (!instance) continue;
    for (const twin of instances) {
      if (twin.id !== instanceId && isTwin(twin, instance)) out[twin.id] = { ...out[twin.id], ...channels };
    }
  }
  return out;
}

/** El número más alto y no la cantidad: un perfil puede tener huecos. */
export const channelCount = (definition: FixtureDefinition | undefined) =>
  (definition?.channels ?? []).reduce((max, c) => Math.max(max, c.index), 0);

export interface PatchRow {
  instance: FixtureInstance;
  first: number;
  last: number;
  /** Problemas de direccionamiento, en texto listo para mostrar. */
  issues: string[];
}

/** Los universos que tienen luces o salidas, en orden. Al menos el 1. */
export const universesOf = (instances: FixtureInstance[], sent: number[]) =>
  [...new Set([1, ...instances.map((i) => i.universe), ...sent])].sort((a, b) => a - b);

/** Qué canales ocupa cada fixture, en orden de dirección, con los choques.
 *  `sent`: los universos que tienen salida, o null si todavía no importa. */
export function describePatch(
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
  sent: number[] | null = null,
): PatchRow[] {
  const rows = instances
    .map((instance): PatchRow => {
      const count = channelCount(definitions.find((d) => d.id === instance.definitionId));
      return { instance, first: instance.address, last: instance.address + count - 1, issues: [] };
    })
    .sort((a, b) => a.instance.universe - b.instance.universe || a.first - b.first);

  for (const row of rows) {
    // Sin ninguna salida ya se sabe que no sale nada.
    if (sent && sent.length > 0 && !sent.includes(row.instance.universe)) {
      row.issues.push(`Universo ${row.instance.universe}: no sale por ningún lado. Agrégale una salida.`);
    }
    if (row.last > DMX_CHANNELS) row.issues.push(`Se pasa del canal ${DMX_CHANNELS}`);
    for (const other of rows) {
      const overlaps =
        other !== row &&
        !isTwin(other.instance, row.instance) &&
        other.instance.universe === row.instance.universe &&
        other.first <= row.last &&
        row.first <= other.last;
      if (overlaps) row.issues.push(`Se pisa con ${other.instance.label} (${other.first}–${other.last})`);
    }
  }

  return rows;
}

/** Primer lugar donde entran `count` canales seguidos sin pisar a nadie; si un
 *  universo está lleno, sigue en el próximo. */
export function nextFreeSlot(
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
  count: number,
): { universe: number; address: number } {
  const rows = describePatch(instances, definitions);
  for (let universe = 1; ; universe++) {
    let address = 1;
    for (const row of rows) {
      if (row.instance.universe !== universe) continue;
      if (address + count - 1 < row.first) break;
      address = Math.max(address, row.last + 1);
    }
    if (address + count - 1 <= DMX_CHANNELS || address === 1) return { universe, address };
  }
}
