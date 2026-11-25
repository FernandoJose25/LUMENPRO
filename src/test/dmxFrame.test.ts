import { describe, it, expect } from "vitest";
import { describePatch, effectiveValue, type FrameInput } from "@/lib/dmxFrame";
import { buildFrame } from "./frame";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import type { ChannelType, FixtureDefinition, FixtureInstance } from "@/types/fixture";

const orus = seedInstances[0]; // DMX 1–16
const par1 = seedInstances[2]; // DMX 33–39

function channelId(definitionId: string, type: ChannelType) {
  return seedDefinitions.find((d) => d.id === definitionId)!.channels.find((c) => c.type === type)!.id;
}

const orusCh = (type: ChannelType) => channelId("def-orus-280", type);
const parCh = (type: ChannelType) => channelId("def-lpc007", type);

function frameWith(
  liveValues: Record<string, Record<string, number>>,
  blackoutActive = false,
  instances: FixtureInstance[] = seedInstances,
  definitions: FixtureDefinition[] = seedDefinitions,
) {
  return buildFrame({ instances, definitions, liveValues, blackoutActive, master: 100, strobeActive: false, identifyId: null });
}

describe("buildFrame — de los valores en vivo a los 512 canales", () => {
  it("cada canal sale en dirección del fixture + índice, y lo no tocado sale con su default", () => {
    const frame = frameWith({
      [orus.id]: { [orusCh("DIMMER")]: 200 },
      [par1.id]: { [parCh("RED")]: 255, [parCh("BLUE")]: 10 },
    });

    expect(frame).toHaveLength(512);
    expect(frame[0]).toBe(128); // canal 1: Pan, default
    expect(frame[5]).toBe(200); // canal 6: Dimmer del Orus #1
    expect(frame.slice(32, 39)).toEqual([255, 255, 0, 10, 0, 0, 0]); // PAR #1
    expect(frame[511]).toBe(0);
  });

  it("una cabeza recién conectada sale con el shutter abierto: 0 sería cerrado y no encendería", () => {
    expect(frameWith({})[6]).toBe(255);
  });

  it("un canal invertido sale espejado", () => {
    const definitions = seedDefinitions.map((d) => ({
      ...d,
      channels: d.channels.map((c) => (c.type === "TILT" ? { ...c, invert: true } : c)),
    }));
    const frame = frameWith({ [orus.id]: { [orusCh("TILT")]: 55 } }, false, seedInstances, definitions);
    expect(frame[2]).toBe(200);
  });

  it("ignora canales más allá del 512 y otros universos en vez de pisar a otros fixtures", () => {
    const frame = frameWith(
      {},
      false,
      [
        { ...par1, id: "a", address: 510 },
        { ...par1, id: "b", address: 1, universe: 2 },
      ],
    );
    expect(frame).toHaveLength(512);
    expect(frame[509]).toBe(255);
    expect(frame[0]).toBe(0);
  });
});

describe("Blackout — apaga sin mover las cabezas", () => {
  const liveValues = {
    [orus.id]: {
      [orusCh("PAN")]: 180,
      [orusCh("TILT")]: 60,
      [orusCh("DIMMER")]: 255,
      [orusCh("GOBO")]: 40,
    },
    [par1.id]: { [parCh("RED")]: 255, [parCh("MODE")]: 220 },
  };

  it("dimmer, color y programas automáticos a 0; pan, tilt, gobo y shutter quedan igual", () => {
    const frame = frameWith(liveValues, true);
    expect(frame[0]).toBe(180); // Pan
    expect(frame[2]).toBe(60); // Tilt
    expect(frame[5]).toBe(0); // Dimmer
    expect(frame[6]).toBe(255); // Shutter: si se cerrara, al volver no abriría solo
    expect(frame[8]).toBe(40); // Gobo
    expect(frame.slice(32, 39)).toEqual([0, 0, 0, 0, 0, 0, 0]); // PAR #1, incluido Color Macro
  });

  it("al quitarlo todo vuelve exactamente como estaba", () => {
    const before = frameWith(liveValues, false);
    frameWith(liveValues, true);
    expect(frameWith(liveValues, false)).toEqual(before);
  });

  it("con el dimmer invertido, apagado es 255 y no 0", () => {
    const definitions = seedDefinitions.map((d) => ({
      ...d,
      channels: d.channels.map((c) => (c.type === "DIMMER" ? { ...c, invert: true } : c)),
    }));
    expect(frameWith(liveValues, true, seedInstances, definitions)[5]).toBe(255);
  });

  it("un fixture sin dimmer ni color se apaga cerrando el shutter", () => {
    const base = seedDefinitions[0];
    const scanner: FixtureDefinition = {
      ...base,
      id: "scanner",
      channels: base.channels.filter((c) => c.type === "PAN" || c.type === "STROBE").map((c, i) => ({ ...c, index: i + 1 })),
    };
    const instance = { ...orus, id: "scan", definitionId: "scanner", address: 100 };
    const frame = frameWith({}, true, [instance], [scanner]);
    expect(frame[99]).toBe(128); // Pan quieto
    expect(frame[100]).toBe(0); // Shutter cerrado
  });
});

describe("Curvas", () => {
  const withCurve = (type: ChannelType, curve: "log" | "s-curve") =>
    seedDefinitions.map((d) => ({ ...d, channels: d.channels.map((c) => (c.type === type ? { ...c, curve } : c)) }));
  const dimmerAt = (value: number, curve: "log" | "s-curve", blackout = false) =>
    frameWith({ [orus.id]: { [orusCh("DIMMER")]: value } }, blackout, seedInstances, withCurve("DIMMER", curve))[5];

  it("suave al encender: apagado y pleno no cambian, a la mitad sale un cuarto", () => {
    expect([0, 128, 255].map((v) => dimmerAt(v, "log"))).toEqual([0, 64, 255]);
  });

  it("suave en los extremos: la mitad queda igual", () => {
    expect([0, 64, 128, 255].map((v) => dimmerAt(v, "s-curve"))).toEqual([0, 40, 128, 255]);
  });

  it("no impide el Blackout", () => {
    expect(dimmerAt(255, "log", true)).toBe(0);
  });

  it("pan y tilt la ignoran: cambiaría a dónde apuntan", () => {
    const frame = frameWith({ [orus.id]: { [orusCh("PAN")]: 60 } }, false, seedInstances, withCurve("PAN", "log"));
    expect(frame[0]).toBe(60);
  });
});

describe("Intensidad y estrobo generales", () => {
  const base = {
    instances: seedInstances,
    definitions: seedDefinitions,
    liveValues: {
      [orus.id]: { [orusCh("DIMMER")]: 200, [orusCh("PAN")]: 180 },
      [par1.id]: { [parCh("RED")]: 255 },
    },
    blackoutActive: false,
    master: 100,
    strobeActive: false,
    identifyId: null,
  };

  it("la intensidad baja el dimmer y nada más", () => {
    const frame = buildFrame({ ...base, master: 50 });
    expect(frame[5]).toBe(100); // Dimmer de la cabeza
    expect(frame[0]).toBe(180); // Pan
    expect(frame.slice(32, 36)).toEqual([128, 255, 0, 0]); // PAR: dimmer a la mitad, color igual
  });

  it("un fixture sin dimmer baja sus colores", () => {
    const definition = seedDefinitions[1];
    const rgbOnly: FixtureDefinition = {
      ...definition,
      id: "rgb",
      channels: definition.channels
        .filter((c) => ["RED", "GREEN", "BLUE"].includes(c.type))
        .map((c, i) => ({ ...c, index: i + 1 })),
    };
    const frame = buildFrame({
      ...base,
      instances: [{ ...par1, definitionId: "rgb", address: 1 }],
      definitions: [rgbOnly],
      master: 20,
    });
    expect(frame.slice(0, 3)).toEqual([51, 0, 0]);
  });

  it("el estrobo usa el rango marcado en cada equipo y al soltarlo todo vuelve igual", () => {
    const frame = buildFrame({ ...base, strobeActive: true });
    expect(frame[6]).toBe(87); // cabeza: dentro de 64–95
    expect(frame[36]).toBe(192); // PAR: 1–255
    expect(buildFrame(base)[6]).toBe(255);
  });

  it("en una cabeza sin rango de estrobo conocido no adivina", () => {
    const definitions = seedDefinitions.map((d) => ({
      ...d,
      channels: d.channels.map((c) => ({ ...c, presets: [] })),
    }));
    const frame = buildFrame({ ...base, definitions, strobeActive: true });
    expect(frame[6]).toBe(255);
    expect(frame[36]).toBe(200);
  });

  it("el Blackout le gana a la intensidad y al estrobo", () => {
    const frame = buildFrame({ ...base, strobeActive: true, blackoutActive: true });
    expect([frame[5], frame[32], frame[33]]).toEqual([0, 0, 0]);
  });
});

describe("El simulador ve lo mismo que sale por el cable", () => {
  const random = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  it.each([1, 2, 3, 4, 5, 6])("rig, valores y botones al azar (%i)", (seed) => {
    const rand = random(seed * 7919);
    const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
    const definitions = seedDefinitions.map((d) => ({
      ...d,
      channels: d.channels.map((c) => ({ ...c, curve: pick(["linear", "log", "s-curve"] as const) })),
    }));
    const input: FrameInput = {
      instances: seedInstances,
      definitions,
      liveValues: Object.fromEntries(
        seedInstances.map((i) => [
          i.id,
          Object.fromEntries(
            definitions
              .find((d) => d.id === i.definitionId)!
              .channels.filter(() => rand() < 0.8)
              .map((c) => [c.id, Math.floor(rand() * 256)]),
          ),
        ]),
      ),
      blackoutActive: rand() < 0.3,
      master: Math.floor(rand() * 101),
      strobeActive: rand() < 0.5,
      identifyId: rand() < 0.5 ? pick(seedInstances).id : null,
    };
    const frame = buildFrame(input);
    for (const instance of seedInstances) {
      const definition = definitions.find((d) => d.id === instance.definitionId)!;
      for (const channel of definition.channels) {
        const expected = Math.round(effectiveValue(instance, definition, channel, input));
        expect(frame[instance.address + channel.index - 2], `${instance.label} ${channel.name}`).toBe(expected);
      }
    }
  });
});

describe("describePatch — choques de direcciones", () => {
  it("el rig de fábrica no tiene choques", () => {
    expect(describePatch(seedInstances, seedDefinitions).flatMap((r) => r.issues)).toEqual([]);
  });

  it("avisa en los dos fixtures cuando la cabeza ocupa más canales de los previstos", () => {
    // El caso real pendiente: si las cabezas son de 26 canales y no de 16.
    const definitions = seedDefinitions.map((d) =>
      d.id === "def-orus-280"
        ? { ...d, channels: Array.from({ length: 26 }, (_, i) => ({ ...d.channels[0], id: `x${i}`, index: i + 1 })) }
        : d,
    );
    const rows = describePatch(seedInstances, definitions);
    expect(rows[0].issues).toEqual(["Se pisa con BEAM 280 ORUS #2 (17–42)"]);
    expect(rows[1].issues).toContain("Se pisa con BEAM 280 ORUS #1 (1–26)");
    expect(rows[1].issues).toContain("Se pisa con LPC007 PAR #1 (33–39)");
  });

  it("un perfil con huecos ocupa hasta su número de canal más alto", () => {
    const definitions = seedDefinitions.map((d) =>
      d.id === "def-lpc007"
        ? { ...d, channels: d.channels.map((c) => (c.type === "STROBE" ? { ...c, index: 12 } : c)) }
        : d,
    );
    const row = describePatch([par1], definitions)[0];
    expect([row.first, row.last]).toEqual([33, 44]);
  });

  it("avisa si se pasa del canal 512 o está en un universo que no se envía", () => {
    const instances = [
      { ...par1, id: "a", address: 510 },
      { ...par1, id: "b", universe: 2 },
    ];
    const issues = (sent: number[] | null) => describePatch(instances, seedDefinitions, sent).map((r) => r.issues);
    expect(issues([1])).toEqual([["Se pasa del canal 512"], ["Universo 2: no sale por ningún lado. Agrégale una salida."]]);
    expect(issues([1, 2])).toEqual([["Se pasa del canal 512"], []]);
    expect(issues([])).toEqual([["Se pasa del canal 512"], []]); // sin salidas ya se sabe
  });
});
