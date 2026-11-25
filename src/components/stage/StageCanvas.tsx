import { useEffect, useMemo, useRef } from "react";
import type { FrameInput } from "@/lib/dmxFrame";
import { drawGobo, goboMask } from "@/lib/gobos";
import {
  approach,
  beamDirection,
  beamEnd,
  DEFAULT_CAMERA,
  defaultPlacements,
  emitterPosition,
  lightStates,
  makeView,
  prismDirections,
  project,
  unproject,
  type LightState,
  type Vec3,
  type View,
} from "@/lib/stage";
import type { FixtureInstance, Placement } from "@/types/fixture";

// Velocidad típica de una cabeza beam.
const PAN_SPEED = 240; // grados por segundo
const TILT_SPEED = 200;
const FLOOR = 7; // medio lado de la grilla, en metros
// Los valores cambian 25 veces por segundo: dibujar a los 144 o 240 Hz de la
// pantalla solo gasta batería.
const MIN_FRAME_MS = 30;
const HIT_RADIUS = 18; // píxeles

interface StageCanvasProps {
  rig: FrameInput;
  selectedId?: string | null;
  /** Con onSelect/onMove las luces se pueden tocar y arrastrar. */
  onSelect?: (instanceId: string | null) => void;
  onMove?: (instanceId: string, position: { x: number; z: number }) => void;
}

/** Más focos que esto se dibujan como puntos: con un cono cada uno, una barra
 *  de píxeles sería una mancha y frenaría la pantalla. */
const MAX_BEAMS = 12;

interface Drawn {
  instance: FixtureInstance;
  placement: Placement;
  beams: { light: LightState; origin: Vec3; direction: Vec3 }[];
  depth: number;
}

/** Simulador: haces en perspectiva con lo mismo que sale por el cable.
 *  Arrastrar el fondo gira la cámara; la rueda acerca. */
export function StageCanvas({ rig, selectedId = null, onSelect, onMove }: StageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const placements = useMemo(() => {
    const defaults = defaultPlacements(rig.instances, rig.definitions);
    return new Map(rig.instances.map((i) => [i.id, i.placement ?? defaults.get(i.id)]));
  }, [rig.instances, rig.definitions]);

  // El bucle de dibujo lee siempre lo último sin reiniciarse.
  const latest = useRef({ rig, placements, selectedId, editable: false });
  latest.current = { rig, placements, selectedId, editable: onSelect !== undefined };

  const camera = useRef({ ...DEFAULT_CAMERA });
  const view = useRef<View | null>(null);
  const heads = useRef(new Map<string, { pan: number; tilt: number }>());

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < MIN_FRAME_MS) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const v = makeView(camera.current, width, height);
      view.current = v;

      const { rig: s, placements: p, selectedId: selected, editable } = latest.current;
      const drawn: Drawn[] = [];
      for (const instance of s.instances) {
        const definition = s.definitions.find((d) => d.id === instance.definitionId);
        const placement = p.get(instance.id);
        if (!definition || !placement) continue;
        const beams = lightStates(instance, definition, s).map((light, n) => {
          let head = light.head;
          if (head) {
            const key = `${instance.id}/${n}`;
            const at = heads.current.get(key) ?? head;
            head = {
              pan: approach(at.pan, head.pan, PAN_SPEED * dt),
              tilt: approach(at.tilt, head.tilt, TILT_SPEED * dt),
            };
            heads.current.set(key, head);
          }
          return {
            light,
            origin: emitterPosition(placement, light.offset),
            direction: beamDirection(placement, head),
          };
        });
        drawn.push({ instance, placement, beams, depth: 1 / (project(v, placement)?.scale ?? Infinity) });
      }
      drawn.sort((a, b) => b.depth - a.depth);

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#07070b";
      ctx.fillRect(0, 0, width, height);
      drawFloor(ctx, v);
      ctx.globalCompositeOperation = "lighter";
      for (const d of drawn) {
        const points = d.beams.length > MAX_BEAMS;
        for (const b of d.beams) drawLight(ctx, v, b, now, points);
      }
      ctx.globalCompositeOperation = "source-over";
      for (const d of drawn) drawBody(ctx, v, d, editable, d.instance.id === selected);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // La rueda necesita un listener no pasivo para no mover la página.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.current.distance = Math.max(5, Math.min(25, camera.current.distance * (e.deltaY > 0 ? 1.08 : 0.92)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ id: string | null; x: number; y: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const [x, y] = [e.clientX - rect.left, e.clientY - rect.top];
    let hit: string | null = null;
    if (onSelect && view.current) {
      let best = HIT_RADIUS;
      for (const [id, placement] of placements) {
        const at = placement && project(view.current, placement);
        const distance = at ? Math.hypot(at.x - x, at.y - y) : Infinity;
        if (distance < best) [hit, best] = [id, distance];
      }
      if (hit) onSelect(hit);
    }
    drag.current = { id: hit, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = drag.current;
    if (!d) return;
    const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
    drag.current = { ...d, x: e.clientX, y: e.clientY };
    if (d.id && onMove && view.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      const placement = placements.get(d.id);
      const at = placement && unproject(view.current, e.clientX - rect.left, e.clientY - rect.top, placement.y);
      // A la altura de los ojos el plano se ve de canto y un píxel son muchos
      // metros: se limita al escenario.
      if (at) onMove(d.id, { x: limit(at.x), z: limit(at.z) });
    } else {
      camera.current.yaw -= dx * 0.35;
      camera.current.pitch = Math.max(2, Math.min(80, camera.current.pitch + dy * 0.3));
    }
  }

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Simulador del escenario"
      className="h-full w-full cursor-grab touch-none rounded-control active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => (camera.current = { ...DEFAULT_CAMERA })}
    />
  );
}

const limit = (v: number) => Math.round(Math.max(-FLOOR, Math.min(FLOOR, v)) * 10) / 10;

function line(ctx: CanvasRenderingContext2D, view: View, a: Vec3, b: Vec3) {
  const [from, to] = [project(view, a), project(view, b)];
  if (!from || !to) return;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawFloor(ctx: CanvasRenderingContext2D, view: View) {
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,.06)";
  for (let i = -FLOOR; i <= FLOOR; i++) {
    line(ctx, view, { x: i, y: 0, z: -FLOOR }, { x: i, y: 0, z: FLOOR });
    line(ctx, view, { x: -FLOOR, y: 0, z: i }, { x: FLOOR, y: 0, z: i });
  }
  // Pista de baile, para orientarse.
  ctx.strokeStyle = "rgba(255,255,255,.22)";
  floorCircle(ctx, view, { x: 0, y: 0, z: 0 }, 2.5, 2.5, 0);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,.3)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  for (const [text, z] of [["PISTA", 0], ["PÚBLICO", 5.5]] as const) {
    const at = project(view, { x: 0, y: 0, z });
    if (at) ctx.fillText(text, at.x, at.y);
  }
}

/** Óvalo sobre el piso: `along` metros en la dirección `angle` y `across` a lo
 *  ancho. */
function floorCircle(
  ctx: CanvasRenderingContext2D,
  view: View,
  center: Vec3,
  along: number,
  across: number,
  angle: number,
) {
  ctx.beginPath();
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const [a, b] = [Math.cos(t) * along, Math.sin(t) * across];
    const at = project(view, {
      x: center.x + a * Math.sin(angle) + b * Math.cos(angle),
      y: 0,
      z: center.z + a * Math.cos(angle) - b * Math.sin(angle),
    });
    if (at) ctx.lineTo(at.x, at.y);
  }
  ctx.closePath();
}

function drawLight(
  ctx: CanvasRenderingContext2D,
  view: View,
  { light, origin, direction }: Drawn["beams"][number],
  now: number,
  pointOnly: boolean,
) {
  if (light.intensity < 0.005) return;
  // Un destello corto por ciclo, como un shutter.
  if (light.strobeHz > 0 && ((now / 1000) * light.strobeHz) % 1 > 0.4) return;
  const from = project(view, origin);
  if (!from) return;
  const strength = Math.sqrt(light.intensity); // el ojo no ve lineal

  if (!pointOnly) {
    const spun = (now / 1000) * light.prismSpin;
    const directions = light.facets > 1 ? prismDirections(direction, light.facets, spun) : [direction];
    // Un prisma reparte la luz entre sus caras.
    const share = directions.length > 1 ? 1.6 / directions.length : 1;
    for (const d of directions) drawBeam(ctx, view, light, origin, d, strength * Math.sqrt(share), now);
  }

  const rgb = light.color.map(Math.round).join(",");
  const glow = (pointOnly ? 0.04 + 0.06 * strength : 0.18 + 0.4 * strength) * from.scale;
  const halo = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, glow);
  halo.addColorStop(0, pointOnly ? `rgba(${rgb},${strength})` : `rgba(255,255,255,${0.9 * strength})`);
  halo.addColorStop(0.25, `rgba(${rgb},${0.6 * strength})`);
  halo.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(from.x, from.y, glow, 0, Math.PI * 2);
  ctx.fill();
}

function drawBeam(
  ctx: CanvasRenderingContext2D,
  view: View,
  light: LightState,
  origin: Vec3,
  direction: Vec3,
  strength: number,
  now: number,
) {
  const { end, onFloor, length } = beamEnd(origin, direction);
  const from = project(view, origin);
  const to = project(view, end);
  if (!from) return;
  const rgb = light.color.map(Math.round).join(",");
  const radius = length * Math.tan((light.spread * Math.PI) / 180) + 0.08;
  const mask = light.gobo ? goboMask(light.gobo) : null;

  if (to) {
    const [dx, dy] = [to.x - from.x, to.y - from.y];
    const distance = Math.hypot(dx, dy);
    if (distance > 1) {
      const [nx, ny] = [-dy / distance, dx / distance];
      const [near, far] = [0.08 * from.scale, radius * to.scale];
      const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
      // Un beam es más denso que un PAR, y un gobo tapa parte de la luz.
      const base = (light.head ? 0.5 : 0.28) * (mask ? 0.6 : 1);
      gradient.addColorStop(0, `rgba(${rgb},${base * strength})`);
      gradient.addColorStop(1, `rgba(${rgb},${(onFloor ? 0.07 : 0) * strength})`);
      ctx.fillStyle = gradient;
      // Dos conos: el de adentro da el centro más brillante.
      for (const k of [1, 0.45]) {
        ctx.beginPath();
        ctx.moveTo(from.x + nx * near, from.y + ny * near);
        ctx.lineTo(to.x + nx * far * k, to.y + ny * far * k);
        ctx.lineTo(to.x - nx * far * k, to.y - ny * far * k);
        ctx.lineTo(from.x - nx * near, from.y - ny * near);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  if (!onFloor) return;
  const along = Math.min(radius / Math.max(0.15, -direction.y), 5);
  const angle = Math.atan2(direction.x, direction.z);
  if (mask) {
    const spun = ((now / 1000) * light.goboSpin * Math.PI) / 180;
    const [cos, sin] = [Math.cos(spun), Math.sin(spun)];
    const place = (u: number, v: number) => {
      const [a, b] = [(u * cos - v * sin) * radius, (u * sin + v * cos) * along];
      return project(view, {
        x: end.x + a * Math.cos(angle) + b * Math.sin(angle),
        y: 0,
        z: end.z - a * Math.sin(angle) + b * Math.cos(angle),
      });
    };
    // Más abierto, más repartida la luz.
    drawGobo(ctx, mask, light.color, place, 0.75 * strength * Math.min(1, 1.2 / (along * radius)));
    return;
  }
  for (const [k, alpha] of [[1, 0.1], [0.7, 0.14], [0.4, 0.18]] as const) {
    ctx.fillStyle = `rgba(${rgb},${alpha * strength})`;
    floorCircle(ctx, view, end, along * k, radius * k, angle);
    ctx.fill();
  }
}

function drawBody(ctx: CanvasRenderingContext2D, view: View, d: Drawn, editable: boolean, selected: boolean) {
  const at = project(view, d.placement);
  if (!at) return;
  ctx.fillStyle = "#2c2c36";
  ctx.strokeStyle = selected ? "#A66CFF" : "#4a4a58";
  ctx.lineWidth = selected ? 2.5 : 1;
  ctx.beginPath();
  ctx.arc(at.x, at.y, Math.max(3, 0.1 * at.scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (!editable) return;
  // Línea al piso: sin ella no se sabe a qué profundidad está.
  ctx.lineWidth = 1;
  ctx.strokeStyle = selected ? "rgba(166,108,255,.7)" : "rgba(255,255,255,.15)";
  line(ctx, view, d.placement, { x: d.placement.x, y: 0, z: d.placement.z });
  ctx.fillStyle = selected ? "#A66CFF" : "rgba(255,255,255,.6)";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(d.instance.label, at.x, at.y - Math.max(10, 0.18 * at.scale));
}
