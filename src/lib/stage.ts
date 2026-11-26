import { effectiveValue, emits, isSubtractive, type FrameInput } from "@/lib/dmxFrame";
import { EMITTER_RGB, hexToRgb } from "@/lib/look";
import type {
  ChannelPreset,
  ChannelType,
  FixtureChannel,
  FixtureDefinition,
  FixtureInstance,
  Placement,
} from "@/types/fixture";

/** Geometría del simulador. Metros; x a la derecha, y arriba, z al público. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const isHead = (definition: FixtureDefinition) => definition.channels.some((c) => c.type === "PAN");

// Recorrido habitual de una cabeza móvil, si el perfil no dice otra cosa.
const PAN_RANGE = 540;
const TILT_RANGE = 270;

/** Ubicación inicial: cabezas apoyadas a los lados de la pista y fijos en una
 *  barra al fondo, apuntando hacia ella. */
export function defaultPlacements(
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
): Map<string, Placement> {
  const heads: FixtureInstance[] = [];
  const fixed: FixtureInstance[] = [];
  for (const i of instances) {
    const definition = definitions.find((d) => d.id === i.definitionId);
    if (definition) (isHead(definition) ? heads : fixed).push(i);
  }
  const spread = (index: number, count: number, width: number) =>
    count === 1 ? 0 : -width / 2 + (width * index) / (count - 1);

  const placements = new Map<string, Placement>();
  heads.forEach((i, n) =>
    placements.set(i.id, { x: spread(n, heads.length, 8), y: 1, z: -3, yaw: 0, pitch: 0, hung: false }),
  );
  fixed.forEach((i, n) =>
    placements.set(i.id, { x: spread(n, fixed.length, 5), y: 2.8, z: -3.5, yaw: 0, pitch: -35, hung: false }),
  );
  return placements;
}

/** Dónde está un foco de una barra. */
export function emitterPosition(placement: Placement, offset: { x: number; y: number }): Vec3 {
  return {
    x: placement.x + offset.x * Math.cos(rad(placement.yaw)),
    y: placement.y + offset.y,
    z: placement.z - offset.x * Math.sin(rad(placement.yaw)),
  };
}

/** Copias del haz que hace un prisma, abiertas alrededor del original. */
export function prismDirections(direction: Vec3, facets: number, angle: number): Vec3[] {
  const side = normalize(Math.abs(direction.y) > 0.95 ? { x: 1, y: 0, z: 0 } : cross(direction, { x: 0, y: 1, z: 0 }));
  const up = cross(side, direction);
  const open = Math.tan(rad(PRISM_ANGLE));
  return Array.from({ length: facets }, (_, i) => {
    const a = rad(angle + (360 * i) / facets);
    const [s, u] = [Math.cos(a) * open, Math.sin(a) * open];
    return normalize({
      x: direction.x + side.x * s + up.x * u,
      y: direction.y + side.y * s + up.y * u,
      z: direction.z + side.z * s + up.z * u,
    });
  });
}

const PRISM_ANGLE = 7;

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * Pan y tilt (0–1, como el pad) para que una cabeza apunte a ese punto. De las
 * dos formas de llegar (y de las vueltas de más) elige la más cercana a donde
 * está; null si ninguna entra en su recorrido.
 */
export function aimAt(
  placement: Placement,
  definition: FixtureDefinition,
  target: Vec3,
  current: { pan: number; tilt: number },
): { pan: number; tilt: number } | null {
  const d = normalize({ x: target.x - placement.x, y: target.y - placement.y, z: target.z - placement.z });
  const away = (Math.acos(clamp(d.y * (placement.hung ? -1 : 1), -1, 1)) * 180) / Math.PI;
  const around = (Math.atan2(d.x, d.z) * 180) / Math.PI - placement.yaw;
  const panRange = definition.panLimit?.max ?? PAN_RANGE;
  const tiltRange = definition.tiltLimit?.max ?? TILT_RANGE;
  let best: { pan: number; tilt: number; distance: number } | null = null;
  for (const [pan, tilt] of [
    [around, away],
    [around + 180, -away],
  ]) {
    for (let turns = -3; turns <= 3; turns++) {
      const option = { pan: (pan + 360 * turns) / panRange + 0.5, tilt: 0.5 - tilt / tiltRange };
      if (option.pan < 0 || option.pan > 1 || option.tilt < 0 || option.tilt > 1) continue;
      const distance = Math.hypot(option.pan - current.pan, option.tilt - current.tilt);
      if (!best || distance < best.distance) best = { ...option, distance };
    }
  }
  return best && { pan: best.pan, tilt: best.tilt };
}

/** Hacia dónde apunta. Con pan y tilt al centro una cabeza apunta recto por su
 *  eje: arriba si está apoyada, abajo si cuelga. */
export function beamDirection(placement: Placement, head: { pan: number; tilt: number } | null): Vec3 {
  if (!head) {
    const flat = Math.cos(rad(placement.pitch));
    return {
      x: flat * Math.sin(rad(placement.yaw)),
      y: Math.sin(rad(placement.pitch)),
      z: flat * Math.cos(rad(placement.yaw)),
    };
  }
  const around = rad(placement.yaw + head.pan);
  const away = rad(head.tilt);
  return {
    x: Math.sin(away) * Math.sin(around),
    y: Math.cos(away) * (placement.hung ? -1 : 1),
    z: Math.sin(away) * Math.cos(around),
  };
}

const BEAM_LENGTH = 11;

/** Dónde termina el haz, y si llega al piso. */
export function beamEnd(origin: Vec3, direction: Vec3): { end: Vec3; onFloor: boolean; length: number } {
  const toFloor = direction.y < -0.02 ? -origin.y / direction.y : Infinity;
  const length = Math.min(toFloor, BEAM_LENGTH);
  return {
    end: {
      x: origin.x + direction.x * length,
      y: origin.y + direction.y * length,
      z: origin.z + direction.z * length,
    },
    onFloor: toFloor <= BEAM_LENGTH,
    length,
  };
}

type Rgb = [number, number, number];

/** Un foco, tal como se ve. Casi todos los equipos tienen uno solo. */
export interface LightState {
  /** 0–1, ya con dimmer, intensidad general y Blackout. */
  intensity: number;
  /** 0–255 por componente, a plena intensidad. */
  color: Rgb;
  /** Grados desde el centro; null en un equipo fijo. */
  head: { pan: number; tilt: number } | null;
  /** Semiángulo del haz en grados. */
  spread: number;
  /** Destellos por segundo; 0 = fijo. */
  strobeHz: number;
  /** Dónde está el foco dentro del equipo: metros a lo ancho y hacia arriba. */
  offset: { x: number; y: number };
  /** Imagen dentro de public/gobos, o null. */
  gobo: string | null;
  /** Grados por segundo. */
  goboSpin: number;
  /** Copias del haz; 0 = sin prisma. */
  facets: number;
  prismSpin: number;
}

const MAX_SPIN = 200; // grados por segundo
const DEFAULT_FACETS = 3;

const fraction = (p: ChannelPreset, value: number) =>
  p.dmxTo > p.dmxFrom ? (value - p.dmxFrom) / (p.dmxTo - p.dmxFrom) : 0.5;

interface Cell {
  /** Los canales del foco y los que comparte con los demás. */
  mine: FixtureChannel[];
  shared: FixtureChannel[];
  offset: { x: number; y: number };
}

// Se calcula una vez por perfil: se dibuja 30 veces por segundo y una barra
// puede tener 160 focos.
const cellsByDefinition = new WeakMap<FixtureDefinition, Cell[]>();

function cellsOf(definition: FixtureDefinition): Cell[] {
  let cells = cellsByDefinition.get(definition);
  if (cells) return cells;
  const heads = definition.heads ?? [];
  // Un pack de dimmers son tantas luces como salidas.
  const outputs =
    definition.kind === "Dimmer" && heads.length === 0
      ? definition.channels.filter((c) => c.type === "DIMMER").map((c) => [c.id])
      : [];
  const groups = heads.length > 0 ? heads : outputs.length > 1 ? outputs : [];
  const grouped = new Set(groups.flat());
  const shared = definition.channels.filter((c) => !grouped.has(c.id));
  cells =
    groups.length === 0
      ? [{ mine: [], shared, offset: { x: 0, y: 0 } }]
      : groups.map((ids, n) => ({
          mine: definition.channels.filter((c) => ids.includes(c.id)),
          shared,
          offset: offsetOf(definition, n, groups.length),
        }));
  cellsByDefinition.set(definition, cells);
  return cells;
}

/** Cómo se ve un equipo con los valores que están saliendo: un estado por foco. */
export function lightStates(
  instance: FixtureInstance,
  definition: FixtureDefinition,
  input: FrameInput,
): LightState[] {
  return cellsOf(definition).map((cell) => ({
    ...lightState(instance, definition, input, cell),
    offset: cell.offset,
  }));
}

function offsetOf(definition: FixtureDefinition, index: number, count: number): { x: number; y: number } {
  if (count === 1) return { x: 0, y: 0 };
  const [columns, rows] =
    definition.grid && definition.grid[0] * definition.grid[1] === count ? definition.grid : [count, 1];
  const width = definition.width && definition.width > 0.2 ? definition.width : Math.max(0.5, columns * 0.1);
  const pitch = width / columns;
  return {
    x: ((index % columns) - (columns - 1) / 2) * pitch,
    y: ((rows - 1) / 2 - Math.floor(index / columns)) * pitch,
  };
}

function lightState(
  instance: FixtureInstance,
  definition: FixtureDefinition,
  input: FrameInput,
  { mine, shared }: Cell,
): Omit<LightState, "offset"> {
  const valueOf = (c: FixtureChannel) => effectiveValue(instance, definition, c, input);
  const find = (type: ChannelType) => mine.find((c) => c.type === type) ?? shared.find((c) => c.type === type);
  const read = (type: ChannelType): number | null => {
    const channel = find(type);
    return channel ? valueOf(channel) : null;
  };
  const presetAt = (type: ChannelType) => {
    const value = read(type);
    const preset =
      value === null ? undefined : find(type)?.presets.find((p) => value >= p.dmxFrom && value <= p.dmxTo);
    return preset && value !== null ? { ...preset, at: fraction(preset, value) } : undefined;
  };

  // El dimmer general y, si hay, el del foco.
  const dimmers = [
    shared.find((c) => c.type === "DIMMER" && c.master) ?? shared.find((c) => c.type === "DIMMER"),
    mine.find((c) => c.type === "DIMMER"),
  ].filter((c) => c !== undefined);
  let intensity = [...new Set(dimmers)].reduce((product, c) => (product * valueOf(c)) / 255, 1);

  let strobeHz = 0;
  const strobe = presetAt("STROBE");
  if (strobe?.kind === "closed" || strobe?.label === "Cerrado") intensity = 0;
  if (strobe?.kind === "strobe" || strobe?.kind === "pulse" || strobe?.label === "Estrobo") strobeHz = 2 + 8 * strobe.at;

  const { color, peak } = colorOf(definition, [...mine, ...shared], valueOf, presetAt);
  intensity *= peak;

  const spin = (type: ChannelType) => {
    const preset = presetAt(type);
    return preset?.kind === "cw" || preset?.kind === "ccw"
      ? (20 + (MAX_SPIN - 20) * preset.at) * (preset.kind === "cw" ? 1 : -1)
      : 0;
  };
  const prism = presetAt("PRISM");

  const pan = read("PAN");
  const tilt = read("TILT");
  const fine = (coarse: ChannelType, type: ChannelType) => {
    const channel = definition.channels.find((c) => c.fineOf !== undefined && c.fineOf === find(coarse)?.id) ?? find(type);
    return channel ? valueOf(channel) / 256 : 0;
  };
  const head =
    pan === null && tilt === null
      ? null
      : {
          pan: (((pan ?? 128) + fine("PAN", "PAN_FINE")) / 256 - 0.5) * (definition.panLimit?.max ?? PAN_RANGE),
          tilt: (0.5 - ((tilt ?? 128) + fine("TILT", "TILT_FINE")) / 256) * (definition.tiltLimit?.max ?? TILT_RANGE),
        };

  return {
    intensity: clamp(intensity, 0, 1),
    color,
    head,
    spread: spreadOf(definition, head !== null, find("ZOOM"), find("IRIS"), valueOf),
    strobeHz,
    gobo: presetAt("GOBO")?.gobo ?? null,
    goboSpin: spin("GOBO_ROT"),
    facets: prism?.kind === "prism" ? (prism.facets ?? DEFAULT_FACETS) : 0,
    prismSpin: spin("PRISM_ROT"),
  };
}

/** El color a plena intensidad y, en los que mezclan, cuánto brilla (0–1). */
function colorOf(
  definition: FixtureDefinition,
  channels: FixtureChannel[],
  valueOf: (c: FixtureChannel) => number,
  presetAt: (type: ChannelType) => ChannelPreset | undefined,
): { color: Rgb; peak: number } {
  const first = (type: ChannelType) => channels.find((c) => c.type === type);
  const read = (type: ChannelType) => {
    const channel = first(type);
    return channel ? valueOf(channel) : 0;
  };
  let color: Rgb = [255, 255, 255];
  let peak = 1;

  const emitters = (Object.keys(EMITTER_RGB) as ChannelType[]).filter((t) => emits(t, definition) && first(t));
  if (emitters.length > 0) {
    const sum: Rgb = [0, 0, 0];
    for (const type of emitters) EMITTER_RGB[type]!.forEach((part, i) => (sum[i] += (part * read(type)) / 255));
    // Sin dimmer la intensidad general ya bajó los colores; el brillo es el
    // del componente más alto.
    const top = Math.max(...sum);
    peak = Math.min(1, top / 255);
    if (top > 0) color = sum.map((v) => (v * 255) / top) as Rgb;
  } else if (first("HUE")) {
    color = hsv(read("HUE") / 255, read("SATURATION") / 255);
  } else if (isSubtractive(definition)) {
    color = [255 - read("CYAN"), 255 - read("MAGENTA"), 255 - read("YELLOW")];
  }

  // La rueda filtra; un color automático reemplaza a la mezcla.
  const wheel = presetAt("COLOR_WHEEL");
  if (wheel?.color) color = color.map((v, i) => (v * presetColor(wheel)[i]) / 255) as Rgb;
  const macro = presetAt("COLOR");
  if (macro?.color && (emitters.length === 0 || read("COLOR") !== first("COLOR")?.defaultValue)) {
    color = presetColor(macro);
    peak = 1;
  }
  return { color, peak };
}

function presetColor(preset: ChannelPreset): Rgb {
  const a = hexToRgb(preset.color!);
  if (!preset.color2) return a;
  const b = hexToRgb(preset.color2);
  return a.map((v, i) => (v + b[i]) / 2) as Rgb;
}

function hsv(hue: number, saturation: number): Rgb {
  const part = (n: number) => {
    const k = (n + hue * 6) % 6;
    return 255 * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [part(5), part(3), part(1)];
}

function spreadOf(
  definition: FixtureDefinition,
  moves: boolean,
  zoom: FixtureChannel | undefined,
  iris: FixtureChannel | undefined,
  valueOf: (c: FixtureChannel) => number,
): number {
  const open = zoom ? (zoom.reversed ? 255 - valueOf(zoom) : valueOf(zoom)) / 255 : 0;
  const { min, max } = definition.lens ?? (moves ? { min: 4, max: 20 } : { min: 28, max: 28 });
  const degrees = (min > 0 ? min : max) + (max - (min > 0 ? min : max)) * open;
  const irisOpen = iris ? 1 - 0.85 * ((iris.reversed ? 255 - valueOf(iris) : valueOf(iris)) / 255) : 1;
  return clamp((degrees / 2) * irisOpen, 0.5, 60);
}

/** Una cabeza real no salta: se acerca a su destino a velocidad limitada. */
export function approach(current: number, target: number, maxStep: number): number {
  return current + clamp(target - current, -maxStep, maxStep);
}

// ---- Cámara ----

export interface Camera {
  /** Órbita alrededor del centro de la pista, en grados. */
  yaw: number;
  pitch: number;
  distance: number;
}

export const DEFAULT_CAMERA: Camera = { yaw: 0, pitch: 12, distance: 13 };
const TARGET: Vec3 = { x: 0, y: 1.6, z: 0 };

export interface View {
  width: number;
  height: number;
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  focal: number;
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export function makeView(camera: Camera, width: number, height: number): View {
  const yaw = rad(camera.yaw);
  const pitch = rad(camera.pitch);
  const back: Vec3 = {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };
  return {
    width,
    height,
    position: {
      x: TARGET.x + back.x * camera.distance,
      y: TARGET.y + back.y * camera.distance,
      z: TARGET.z + back.z * camera.distance,
    },
    forward: { x: -back.x, y: -back.y, z: -back.z },
    right: { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) },
    up: { x: -Math.sin(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: -Math.cos(yaw) * Math.sin(pitch) },
    focal: Math.min(width * 1.05, height * 1.5),
  };
}

export interface Projected {
  x: number;
  y: number;
  /** Píxeles por metro a esa profundidad. */
  scale: number;
}

/** null si queda detrás de la cámara. */
export function project(view: View, point: Vec3): Projected | null {
  const d = sub(point, view.position);
  const depth = dot(d, view.forward);
  if (depth < 0.2) return null;
  const scale = view.focal / depth;
  return {
    x: view.width / 2 + dot(d, view.right) * scale,
    y: view.height / 2 - dot(d, view.up) * scale,
    scale,
  };
}

/** Punto del plano horizontal `y` que está bajo un píxel, para arrastrar. */
export function unproject(view: View, px: number, py: number, y: number): Vec3 | null {
  const u = (px - view.width / 2) / view.focal;
  const v = (view.height / 2 - py) / view.focal;
  const ray: Vec3 = {
    x: view.forward.x + view.right.x * u + view.up.x * v,
    y: view.forward.y + view.right.y * u + view.up.y * v,
    z: view.forward.z + view.right.z * u + view.up.z * v,
  };
  if (Math.abs(ray.y) < 1e-4) return null;
  const t = (y - view.position.y) / ray.y;
  if (t <= 0) return null;
  return { x: view.position.x + ray.x * t, y, z: view.position.z + ray.z * t };
}
