import { existsSync } from "node:fs";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { loadDefinition, loadLibrary, searchLibrary, type LibraryEntry } from "@/lib/library";
import { colorValues, takesColor } from "@/lib/look";
import { writeAxis } from "@/lib/panTilt";
import { lightStates } from "@/lib/stage";
import { CHANNEL_TYPE_LABELS, type ChannelType, type FixtureDefinition, type FixtureInstance } from "@/types/fixture";
import { ColorSwatches } from "@/components/fixtures/ColorSwatches";
import { buildFrame } from "./frame";
import { serveLibrary } from "./library";

let entries: LibraryEntry[];

beforeAll(async () => {
  serveLibrary();
  entries = await loadLibrary();
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

const entry = (maker: string, model: string) => entries.find((e) => e.maker === maker && e.model === model)!;
const load = (maker: string, model: string, mode: string) => loadDefinition(entry(maker, model), mode);
const types = (d: FixtureDefinition) => d.channels.map((c) => c.type);

function unit(definition: FixtureDefinition): FixtureInstance {
  return { id: "u", definitionId: definition.id, label: "U", universe: 1, address: 1 };
}

function rig(definition: FixtureDefinition, values: Record<string, number> = {}) {
  return {
    instances: [unit(definition)],
    definitions: [definition],
    liveValues: { u: values },
    blackoutActive: false,
    master: 100,
    strobeActive: false,
    identifyId: null,
  };
}
const look = (definition: FixtureDefinition, values: Record<string, number> = {}) =>
  lightStates(unit(definition), definition, rig(definition, values));

describe("Biblioteca completa", () => {
  it("trae los 1781 perfiles con sus 5234 modos", () => {
    expect(entries).toHaveLength(1781);
    expect(entries.reduce((n, e) => n + e.modes.length, 0)).toBe(5234);
    expect(new Set(entries.map((e) => e.maker)).size).toBe(147);
  });

  it("todos los modos arman un perfil válido: canales seguidos, ids únicos, finos con su canal y gobos que existen", async () => {
    const problems: string[] = [];
    for (const e of entries) {
      for (const m of e.modes) {
        const d = await loadDefinition(e, m.name);
        const at = `${e.maker} ${e.model} [${m.name}]`;
        const ids = new Set(d.channels.map((c) => c.id));
        if (d.channels.length !== m.channels || ids.size !== m.channels) problems.push(`${at}: canales`);
        d.channels.forEach((c, i) => {
          if (c.index !== i + 1) problems.push(`${at}: ${c.name} en ${c.index}`);
          if (!(c.type in CHANNEL_TYPE_LABELS)) problems.push(`${at}: tipo ${c.type}`);
          if (c.defaultValue < 0 || c.defaultValue > 255) problems.push(`${at}: ${c.name} arranca en ${c.defaultValue}`);
          if (c.fineOf && !ids.has(c.fineOf)) problems.push(`${at}: ${c.name} completa a nadie`);
          for (const p of c.presets) {
            if (p.dmxFrom > p.dmxTo || p.dmxTo > 255) problems.push(`${at}: ${c.name} ${p.label}`);
            if (p.gobo && !existsSync(`public/gobos/${p.gobo}`)) problems.push(`${at}: falta ${p.gobo}`);
          }
        });
        if (d.heads?.flat().some((id) => !ids.has(id))) problems.push(`${at}: foco con un canal de otro`);
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);

  it("lleva los créditos y la licencia de QLC+ dentro del programa", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Ver licencia" }));
    expect(await screen.findByText(/Apache License/)).toHaveTextContent(/Massimo Callegari/);
  });
});

describe("Buscar", () => {
  const first = (query: string) => {
    const e = searchLibrary(entries, query)[0];
    return e && `${e.maker} ${e.model}`;
  };

  it.each(["LPC007", "lpc-007", "Betopper LPC 007", "betopper 007"])("%s encuentra el PAR", (query) => {
    expect(first(query)).toBe("Betopper LPC-007");
  });

  it("el modelo exacto va primero, sin importar acentos ni mayúsculas", () => {
    expect(first("róbin 600e spot")).toBe("Robe Robin 600E Spot (v1.1)");
    expect(searchLibrary(entries, "no existe esto")).toEqual([]);
    expect(searchLibrary(entries, "   ")).toHaveLength(1781);
  });
});

describe("Del perfil al equipo", () => {
  it("el PAR LPC-007 de 7 canales es igual al que ya traía el programa", async () => {
    const par = await load("Betopper", "LPC-007", "7 Channel");
    expect(types(par)).toEqual(["DIMMER", "RED", "GREEN", "BLUE", "STROBE", "COLOR", "SPEED"]);
    const dimmer = par.channels[0].id;
    expect(buildFrame(rig(par, { [dimmer]: 255, ...colorValues(par, "#ff0000") })).slice(0, 7)).toEqual([
      255, 255, 0, 0, 0, 0, 0,
    ]);
  });

  it("cambiar de modo conserva los ids de los canales que comparten: las escenas siguen valiendo", async () => {
    const [seven, three] = [await load("Betopper", "LPC-007", "7 Channel"), await load("Betopper", "LPC-007", "3 Channel")];
    expect(three.channels.map((c) => c.id)).toEqual(seven.channels.slice(1, 4).map((c) => c.id));
    expect(three.id).not.toBe(seven.id);
  });

  it("una cabeza arranca centrada, con el shutter abierto y apagada", async () => {
    const heads = entries.filter((e) => e.kind === "Moving Head");
    let open = 0;
    let shutters = 0;
    for (const e of heads) {
      const d = await loadDefinition(e, e.modes[0].name);
      const at = (type: ChannelType) => d.channels.find((c) => c.type === type);
      expect(at("PAN")?.defaultValue ?? 128, `${e.maker} ${e.model}`).toBe(128);
      expect(at("DIMMER")?.defaultValue ?? 0, `${e.maker} ${e.model}`).toBeLessThanOrEqual(255);
      const shutter = at("STROBE");
      if (!shutter?.presets.some((p) => p.kind === "open")) continue;
      shutters++;
      const preset = shutter.presets.find((p) => shutter.defaultValue >= p.dmxFrom && shutter.defaultValue <= p.dmxTo);
      if (preset?.kind === "open") open++;
    }
    expect(shutters).toBeGreaterThan(300);
    expect(open).toBe(shutters);
  });

  it("los canales finos completan al suyo", async () => {
    const spot = await load("Robe", "Robin 600E Spot (v1.1)", entry("Robe", "Robin 600E Spot (v1.1)").modes[0].name);
    const pan = spot.channels.find((c) => c.type === "PAN")!;
    const fine = spot.channels.find((c) => c.type === "PAN_FINE")!;
    expect(fine.fineOf).toBe(pan.id);
    expect(writeAxis(spot, "PAN", 1)).toEqual({ [pan.id]: 255, [fine.id]: 255 });
  });

  it("usa el recorrido real de cada cabeza", async () => {
    const e = entries.find((e) => e.kind === "Moving Head" && e.model === "Robin 600E Spot (v1.1)")!;
    const d = await loadDefinition(e, e.modes[0].name);
    expect(d.panLimit?.max).toBeGreaterThan(400);
    const pan = d.channels.find((c) => c.type === "PAN")!;
    expect(look(d, { [pan.id]: 0 })[0].head!.pan).toBeCloseTo(-d.panLimit!.max / 2, 0);
  });
});

describe("Colores según el equipo", () => {
  it("LED: solo los que hacen falta, sin dejar prendidos ámbar ni UV", async () => {
    const e = entries.find((e) => e.kind === "Color Changer" && /RGBWA/.test(e.model))!;
    const d = await loadDefinition(e, e.modes[e.modes.length - 1].name);
    const values = colorValues(d, "#00ff00");
    for (const c of d.channels) {
      if (c.type === "GREEN") expect(values[c.id]).toBe(255);
      if (["RED", "BLUE", "AMBER", "UV", "WHITE"].includes(c.type)) expect(values[c.id]).toBe(0);
    }
  });

  it("filtros CMY: al revés", async () => {
    for (const e of entries.filter((e) => e.kind === "Moving Head")) {
      const d = await loadDefinition(e, e.modes[0].name);
      const t = types(d);
      if (!t.includes("CYAN") || t.includes("RED") || t.includes("FINE")) continue;
      const values = colorValues(d, "#ff0000");
      const at = (type: ChannelType) => values[d.channels.find((c) => c.type === type)!.id];
      expect([at("CYAN"), at("MAGENTA"), at("YELLOW")]).toEqual([0, 255, 255]);
      expect(look(d, values)[0].color.map(Math.round)).toEqual([255, 0, 0]);
      return;
    }
    throw new Error("ninguna cabeza CMY");
  });

  it("rueda de color: el más parecido, y así se ve en el simulador", async () => {
    let tried = 0;
    for (const e of entries.filter((e) => e.kind === "Moving Head")) {
      const d = await loadDefinition(e, e.modes[0].name);
      const wheel = d.channels.find((c) => c.type === "COLOR_WHEEL" && c.presets.some((p) => p.color === "#ff0000"));
      if (!wheel || types(d).some((t) => t === "RED" || t === "CYAN" || t === "HUE")) continue;
      expect(takesColor(d)).toBe(true);
      expect(look(d, colorValues(d, "#ff0000"))[0].color).toEqual([255, 0, 0]);
      if (++tried === 20) return;
    }
    throw new Error(`solo ${tried}`);
  });
});

describe("Simulador", () => {
  it("una barra de píxeles tiene un foco por píxel, en fila y cada uno con su color", async () => {
    const e = entries.find((e) => e.kind === "LED Bar (Pixels)" && e.modes.some((m) => m.channels === 24))!;
    const d = await loadDefinition(e, e.modes.find((m) => m.channels === 24)!.name);
    expect(d.heads!.length).toBeGreaterThan(1);
    const red = d.channels.find((c) => c.type === "RED" && d.heads![0].includes(c.id))!;
    const dimmers = Object.fromEntries(d.channels.filter((c) => c.type === "DIMMER").map((c) => [c.id, 255]));
    const lights = look(d, { ...dimmers, [red.id]: 255 });
    expect(lights).toHaveLength(d.heads!.length);
    expect(lights[0].intensity).toBe(1);
    expect(lights[1].intensity).toBe(0);
    expect(lights[1].offset.x).toBeGreaterThan(lights[0].offset.x);
  });

  it("muestra el gobo y el prisma elegidos", async () => {
    let seen = 0;
    for (const e of entries.filter((e) => e.kind === "Moving Head")) {
      const d = await loadDefinition(e, e.modes[0].name);
      const gobo = d.channels.find((c) => c.type === "GOBO" && c.presets.some((p) => p.gobo && !p.kind));
      const prism = d.channels.find((c) => c.type === "PRISM" && c.presets.some((p) => p.kind === "prism"));
      if (!gobo || !prism) continue;
      const g = gobo.presets.filter((p) => p.gobo && !p.kind).slice(-1)[0];
      const p = prism.presets.find((p) => p.kind === "prism")!;
      const state = look(d, { [gobo.id]: g.dmxFrom, [prism.id]: p.dmxFrom })[0];
      const overlapped = d.channels.some((c) => c !== gobo && c.type === "GOBO");
      if (!overlapped) expect(state.gobo).toBe(g.gobo);
      expect(state.facets).toBe(p.facets ?? 3);
      if (++seen === 10) return;
    }
    throw new Error(`solo ${seen}`);
  });
});

describe("Elegir de la biblioteca", () => {
  it("buscar el LPC007, elegir 7 canales y agregar cuatro en direcciones libres", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Fixtures" }));
    await user.click(screen.getByRole("button", { name: "+ Elegir de la biblioteca" }));
    await user.type(screen.getByLabelText("Buscar en la biblioteca"), "LPC007");
    const list = screen.getByRole("list", { name: "Equipos" });
    await user.click(await within(list).findByRole("button", { name: /Betopper LPC-007/ }));
    await user.selectOptions(screen.getByLabelText(/Modo/), "7 Channel");
    fireEvent.change(screen.getByLabelText("Cuántos"), { target: { value: "4" } });
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    const group = await screen.findByRole("button", { name: /LPC-007\s*7 Channel/ });
    expect(group).toHaveTextContent("4");
    await user.click(group);
    expect(screen.getByRole("button", { name: "LPC-007 #4" })).toBeInTheDocument();
    const addresses = screen.getAllByRole("spinbutton").map((i) => (i as HTMLInputElement).value);
    expect(addresses).toEqual(expect.arrayContaining(["61", "68", "75", "82"]));
  });

  it("cambiar el modo después cambia todas las unidades", async () => {
    const user = userEvent.setup();
    let store!: ReturnType<typeof useFixtureStore>;
    function Probe() {
      store = useFixtureStore();
      return null;
    }
    const { FixturesView } = await import("@/components/views/FixturesView");
    const par = await load("Betopper", "LPC-007", "7 Channel");
    render(
      <FixtureStoreProvider>
        <Probe />
        <FixturesView />
      </FixtureStoreProvider>,
    );
    const { act } = await import("@testing-library/react");
    act(() => {
      store.addDefinition(par);
      store.addInstance({ ...unit(par), address: 100 });
    });
    await user.click(screen.getByRole("button", { name: /LPC-007\s*7 Channel/ }));
    await user.selectOptions(await screen.findByLabelText("Modo de LPC-007"), "3 Channel");
    await waitFor(() => expect(store.instances.find((i) => i.id === "u")!.definitionId).toMatch(/3 Channel$/));
    expect(store.instances.filter((i) => i.definitionId === "def-lpc007")).toHaveLength(4); // los de antes, igual
  });

  it("los colores de un toque también salen en una cabeza con rueda", async () => {
    const e = entries.find((e) => e.maker === "Chauvet" && /Intimidator Spot/.test(e.model))!;
    const d = await loadDefinition(e, e.modes[0].name);
    let store!: ReturnType<typeof useFixtureStore>;
    function Probe() {
      store = useFixtureStore();
      return <ColorSwatches instances={store.instances.filter((i) => i.id === "u")} />;
    }
    render(
      <FixtureStoreProvider>
        <Probe />
      </FixtureStoreProvider>,
    );
    const { act } = await import("@testing-library/react");
    act(() => {
      store.addDefinition(d);
      store.addInstance(unit(d));
    });
    fireEvent.click(screen.getByRole("button", { name: "Rojo" }));
    const wheel = d.channels.find((c) => c.type === "COLOR_WHEEL")!;
    expect(store.getChannelValue("u", wheel.id, 0)).toBeGreaterThan(0);
    const dimmer = d.channels.find((c) => c.type === "DIMMER")!;
    expect(store.getChannelValue("u", dimmer.id, 0)).toBe(255);
  });
});
