import { describe, it, expect } from "vitest";
import { catalogUpdate } from "@/lib/effectPresets";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import type { Effect } from "@/types/effect";
import type { Moment } from "@/types/moment";

const wave = (id: string, name: string, channelType: Effect["channelType"]): Effect => ({
  id, name, groupId: "pars", kind: "wave", figure: "circle", sizeDeg: 20, angleDeg: 0, channelType, waveform: "sine",
  speedCpm: 30, min: 0, max: 255, phaseOffsetDeg: 90, source: "clock", beatsPerCycle: 1, createdAt: 0, updatedAt: 0,
});

const moment = (id: string, effectIds: string[]): Moment => ({
  id, name: id, sceneId: null, chaseId: null, effectIds, fadeMs: 0, durationSec: null,
});

/** Como el show del usuario: la plantilla vieja (la ola en tres pedazos) y
 *  una ola azul suelta en la Entrada. */
function oldShow() {
  const pars = seedInstances.filter((i) => seedDefinitions.find((d) => d.id === i.definitionId)?.channels.some((c) => c.type === "RED"));
  return {
    definitions: seedDefinitions,
    instances: seedInstances.map((i) => (pars.includes(i) ? { ...i, group: "pars" } : i)),
    groups: [{ id: "pars", name: "PAR", color: "#f00" }],
    effects: [
      wave("r", "PAR: ola roja", "RED"),
      wave("g", "PAR: ola verde", "GREEN"),
      wave("b", "PAR: ola azul", "BLUE"),
      wave("bass", "PAR: golpe de graves", "DIMMER"),
      wave("x", "PAR: arcoíris rojo", "RED"),
    ],
    moments: [moment("hora", ["r", "g", "b", "bass"]), moment("entrada", ["b"])],
    livePads: [{ id: "p", label: "Ola", size: 1 as const, action: { do: "effect" as const, id: "r" } }],
    phonePads: [],
    controls: [],
    timelines: [],
  };
}

describe("Puesta al día de los effects", () => {
  it("los pedazos de una ola pasan a ser el arcoíris entero; uno suelto en un momento sale", () => {
    let n = 0;
    const next = catalogUpdate(oldShow(), (prefix) => `${prefix}-${++n}`)!;
    const names = next.effects.map((fx) => fx.name);
    for (const gone of ["PAR: ola roja", "PAR: ola verde", "PAR: ola azul", "PAR: arcoíris rojo"]) {
      expect(names).not.toContain(gone);
    }
    const rainbow = next.effects.find((fx) => fx.name === "PAR: arcoíris")!;
    expect(rainbow).toMatchObject({ kind: "pixels", pattern: "rainbow" });
    expect(names.filter((name) => name === "PAR: arcoíris")).toHaveLength(1);

    const [hora, entrada] = next.moments;
    expect(hora.effectIds).toEqual(["bass", rainbow.id]);
    expect(entrada.effectIds).toEqual([]);
    expect(next.livePads[0].action).toEqual({ do: "effect", id: rainbow.id });
    // Y llegan los efectos listos que faltaban.
    expect(names).toEqual(expect.arrayContaining(["PAR: policía", "PAR: fuego"]));
  });

  it("un effect repetido con otro nombre pasa al de ahora sin salir del momento, y lo borrado no vuelve", () => {
    let n = 0;
    const show = oldShow();
    const updated = { ...show, ...catalogUpdate(show, (prefix) => `${prefix}-${++n}`)! };
    const rainbow = updated.effects.find((fx) => fx.name === "PAR: arcoíris")!;
    const twin = { ...rainbow, id: "twin", name: "PAR: colores que corren", speedCpm: 20 };
    const withTwin = {
      ...updated,
      effects: [...updated.effects.filter((fx) => fx.name !== "PAR: policía"), twin],
      moments: [moment("vals", ["twin"])],
    };
    const next = catalogUpdate(withTwin, (prefix) => `${prefix}-${++n}`, 2)!;
    expect(next.effects.map((fx) => fx.name)).not.toContain("PAR: colores que corren");
    expect(next.moments[0].effectIds).toEqual([rainbow.id]);
    // La policía la borró el usuario: no vuelve.
    expect(next.effects.map((fx) => fx.name)).not.toContain("PAR: policía");
  });

  it("al día, no cambia nada", () => {
    let n = 0;
    const once = catalogUpdate(oldShow(), (prefix) => `${prefix}-${++n}`)!;
    expect(catalogUpdate({ ...oldShow(), ...once }, (prefix) => `${prefix}-${++n}`)).toBeNull();
  });
});
