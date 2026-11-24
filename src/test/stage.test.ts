import { describe, it, expect } from "vitest";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import type { FrameInput } from "@/lib/dmxFrame";
import {
  approach,
  beamDirection,
  beamEnd,
  DEFAULT_CAMERA,
  defaultPlacements,
  lightState,
  makeView,
  project,
  unproject,
} from "@/lib/stage";
import type { ChannelType, Placement } from "@/types/fixture";

const [orusDef, parDef] = seedDefinitions;
const orus = seedInstances[0];
const par = seedInstances[2];
const floorHead: Placement = { x: 0, y: 1, z: 0, yaw: 0, pitch: 0, hung: false };

const orusCh = (type: ChannelType) => orusDef.channels.find((c) => c.type === type)!.id;
const parCh = (type: ChannelType) => parDef.channels.find((c) => c.type === type)!.id;

function input(patch: Partial<FrameInput> = {}): FrameInput {
  return {
    instances: seedInstances,
    definitions: seedDefinitions,
    liveValues: {},
    blackoutActive: false,
    master: 100,
    strobeActive: false,
    identifyId: null,
    ...patch,
  };
}
const orusLight = (values: Record<string, number>, patch: Partial<FrameInput> = {}) =>
  lightState(orus, orusDef, input({ liveValues: { [orus.id]: values }, ...patch }));
const parLight = (values: Record<string, number>, patch: Partial<FrameInput> = {}) =>
  lightState(par, parDef, input({ liveValues: { [par.id]: values }, ...patch }));

describe("Hacia dónde apunta", () => {
  const near = (v: { x: number; y: number; z: number }, x: number, y: number, z: number) => {
    expect(v.x).toBeCloseTo(x, 5);
    expect(v.y).toBeCloseTo(y, 5);
    expect(v.z).toBeCloseTo(z, 5);
  };

  it("al centro, una cabeza apoyada apunta arriba y una colgada abajo", () => {
    near(beamDirection(floorHead, { pan: 0, tilt: 0 }), 0, 1, 0);
    near(beamDirection({ ...floorHead, hung: true }, { pan: 0, tilt: 0 }), 0, -1, 0);
  });

  it("inclinada 90° apunta al público, y el pan o el giro la llevan a un lado", () => {
    near(beamDirection(floorHead, { pan: 0, tilt: 90 }), 0, 0, 1);
    near(beamDirection(floorHead, { pan: 90, tilt: 90 }), 1, 0, 0);
    near(beamDirection({ ...floorHead, yaw: 180 }, { pan: 0, tilt: 90 }), 0, 0, -1);
  });

  it("un equipo fijo usa su inclinación", () => {
    near(beamDirection({ ...floorHead, pitch: -90 }, null), 0, -1, 0);
    near(beamDirection({ ...floorHead, yaw: 90 }, null), 1, 0, 0);
  });

  it("siempre es un vector de largo 1", () => {
    for (const pan of [-200, 33, 270])
      for (const tilt of [-100, 12, 130]) {
        const d = beamDirection({ ...floorHead, yaw: 40 }, { pan, tilt });
        expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
      }
  });

  it("el haz termina en el piso si lo alcanza, o se pierde en el aire", () => {
    const down = beamEnd({ x: 0, y: 3, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(down.onFloor).toBe(true);
    expect(down.end.y).toBeCloseTo(0, 6);
    const up = beamEnd({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(up.onFloor).toBe(false);
    expect(Number.isFinite(up.length)).toBe(true);
  });
});

describe("Cómo se ve cada luz", () => {
  it("una cabeza recién puesta está apagada y al subir el dimmer enciende en blanco", () => {
    expect(orusLight({}).intensity).toBe(0);
    expect(orusLight({ [orusCh("DIMMER")]: 255 })).toMatchObject({ intensity: 1, color: [255, 255, 255] });
  });

  it("con el estrobo en Cerrado no se ve aunque el dimmer esté arriba", () => {
    expect(orusLight({ [orusCh("DIMMER")]: 255, [orusCh("STROBE")]: 0 }).intensity).toBe(0);
  });

  it("pan y tilt al centro son 0°, y los extremos el recorrido del equipo", () => {
    expect(orusLight({ [orusCh("PAN")]: 128, [orusCh("TILT")]: 128 }).head).toEqual({ pan: 0, tilt: expect.closeTo(0, 6) });
    const max = orusLight({ [orusCh("PAN")]: 255, [orusCh("PAN_FINE")]: 255 }).head!;
    expect(max.pan).toBeGreaterThan(268);
    expect(max.pan).toBeLessThanOrEqual(270);
  });

  it("el color del PAR sale de sus canales, con el brillo en la intensidad", () => {
    const red = parLight({ [parCh("RED")]: 128 });
    expect(red.color).toEqual([255, 0, 0]);
    expect(red.intensity).toBeCloseTo(128 / 255, 5);
    expect(parLight({}).intensity).toBe(0); // sin color no hay luz, aunque el dimmer esté a tope
  });

  it("respeta intensidad general y Blackout", () => {
    const on = { [orusCh("DIMMER")]: 255 };
    expect(orusLight(on, { master: 30 }).intensity).toBeCloseTo(0.3, 5);
    expect(orusLight(on, { blackoutActive: true }).intensity).toBe(0);
  });

  it("el estrobo general hace parpadear a los dos, y más rápido cuanto más alto", () => {
    expect(orusLight({ [orusCh("DIMMER")]: 255 }, { strobeActive: true }).strobeHz).toBeGreaterThan(0);
    expect(parLight({ [parCh("RED")]: 255 }).strobeHz).toBe(0);
    const slow = parLight({ [parCh("STROBE")]: 10 }).strobeHz;
    const fast = parLight({ [parCh("STROBE")]: 250 }).strobeHz;
    expect(fast).toBeGreaterThan(slow);
  });

  it("la rueda de color usa el color anotado en el preset", () => {
    const definition = {
      ...orusDef,
      channels: orusDef.channels.map((c) =>
        c.type === "COLOR_WHEEL"
          ? { ...c, presets: [{ id: "p", label: "Azul", dmxFrom: 40, dmxTo: 50, color: "#0000ff" }] }
          : c,
      ),
    };
    const at = (value: number) =>
      lightState(orus, definition, input({ liveValues: { [orus.id]: { [orusCh("COLOR_WHEEL")]: value } } })).color;
    expect(at(45)).toEqual([0, 0, 255]);
    expect(at(0)).toEqual([255, 255, 255]);
  });
});

describe("Movimiento y posiciones", () => {
  it("la cabeza se acerca a velocidad limitada y no se pasa", () => {
    expect(approach(0, 100, 10)).toBe(10);
    expect(approach(0, -100, 10)).toBe(-10);
    expect(approach(95, 100, 10)).toBe(100);
  });

  it("ubica todas las luces, sin encimarlas", () => {
    const placements = [...defaultPlacements(seedInstances, seedDefinitions).values()];
    expect(placements).toHaveLength(6);
    expect(new Set(placements.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(6);
  });

  it("con una sola luz de un tipo la pone al centro", () => {
    const only = defaultPlacements([orus], seedDefinitions).get(orus.id)!;
    expect(only.x).toBe(0);
  });
});

describe("Cámara", () => {
  const view = makeView(DEFAULT_CAMERA, 800, 600);

  it("lo que está a la derecha y arriba se dibuja a la derecha y arriba", () => {
    const center = project(view, { x: 0, y: 1.6, z: 0 })!;
    expect(center.x).toBeCloseTo(400, 3);
    expect(center.y).toBeCloseTo(300, 3);
    const other = project(view, { x: 2, y: 3, z: 0 })!;
    expect(other.x).toBeGreaterThan(center.x);
    expect(other.y).toBeLessThan(center.y);
  });

  it("lo de atrás de la cámara no se dibuja", () => {
    expect(project(view, { x: 0, y: 2, z: 100 })).toBeNull();
  });

  it("arrastrar devuelve el mismo punto que se proyectó, desde cualquier ángulo", () => {
    for (const yaw of [0, 70, -130, 180]) {
      const v = makeView({ yaw, pitch: 30, distance: 12 }, 800, 600);
      const point = { x: 2.3, y: 1, z: -1.7 };
      const at = project(v, point)!;
      const back = unproject(v, at.x, at.y, point.y)!;
      expect(back.x).toBeCloseTo(point.x, 4);
      expect(back.z).toBeCloseTo(point.z, 4);
    }
  });
});
