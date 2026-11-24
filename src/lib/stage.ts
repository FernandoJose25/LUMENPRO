import { effectiveValue, type FrameInput } from "@/lib/dmxFrame";
import { hexToRgb } from "@/lib/look";
import type { ChannelType, FixtureDefinition, FixtureInstance, Placement } from "@/types/fixture";

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

export interface LightState {
  /** 0–1, ya con dimmer, intensidad general y Blackout. */
  intensity: number;
  /** 0–255 por componente, a plena intensidad. */
  color: [number, number, number];
  /** Grados desde el centro; null en un equipo fijo. */
  head: { pan: number; tilt: number } | null;
  /** Semiángulo del haz en grados. */
  spread: number;
  /** Destellos por segundo; 0 = fijo. */
  strobeHz: number;
}

/** Cómo se ve un equipo con los valores que están saliendo. Los gobos y el
 *  prisma no se simulan: sin el manual no se sabe qué dibujan. */
export function lightState(instance: FixtureInstance, definition: FixtureDefinition, input: FrameInput): LightState {
  const find = (type: ChannelType) => definition.channels.find((c) => c.type === type);
  const read = (type: ChannelType): number | null => {
    const channel = find(type);
    return channel ? effectiveValue(instance, definition, channel, input) : null;
  };
  const presetAt = (type: ChannelType, value: number | null) =>
    value === null ? undefined : find(type)?.presets.find((p) => value >= p.dmxFrom && value <= p.dmxTo);

  let intensity = (read("DIMMER") ?? 255) / 255;
  let strobeHz = 0;
  const strobe = read("STROBE");
  const strobePreset = presetAt("STROBE", strobe);
  if (strobePreset?.label === "Cerrado") intensity = 0;
  if (strobe !== null && strobePreset?.label === "Estrobo") {
    const { dmxFrom, dmxTo } = strobePreset;
    strobeHz = 2 + 8 * (dmxTo > dmxFrom ? (strobe - dmxFrom) / (dmxTo - dmxFrom) : 0.5);
  }

  let color: [number, number, number] = [255, 255, 255];
  if (find("RED")) {
    const white = read("WHITE") ?? 0;
    color = [read("RED") ?? 0, read("GREEN") ?? 0, read("BLUE") ?? 0].map((v) => Math.min(255, v + white)) as typeof color;
    // Sin dimmer la intensidad general ya bajó los colores; el brillo es el
    // del componente más alto.
    const peak = Math.max(...color);
    intensity *= peak / 255;
    if (peak > 0) color = color.map((v) => (v * 255) / peak) as typeof color;
  } else {
    const wheel = presetAt("COLOR_WHEEL", read("COLOR_WHEEL"))?.color;
    if (wheel) color = hexToRgb(wheel);
  }

  const pan = read("PAN");
  const tilt = read("TILT");
  const fine = (type: ChannelType) => (read(type) ?? 0) / 256;
  const head =
    pan === null
      ? null
      : {
          pan: ((pan + fine("PAN_FINE")) / 256 - 0.5) * (definition.panLimit?.max ?? PAN_RANGE),
          tilt: (0.5 - ((tilt ?? 128) + fine("TILT_FINE")) / 256) * (definition.tiltLimit?.max ?? TILT_RANGE),
        };

  return {
    intensity: clamp(intensity, 0, 1),
    color,
    head,
    spread: head ? 2 + (8 * (read("ZOOM") ?? 0)) / 255 : 14,
    strobeHz,
  };
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
