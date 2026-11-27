import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";
import { willAnswer } from "./dialogs";
import { STORAGE_KEY } from "@/lib/showFile";
import { CATALOG_VERSION } from "@/lib/effectPresets";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

async function withTemplate() {
  const user = userEvent.setup();
  const engine = fakeEngine();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Momentos" }));
  await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
  return { user, engine };
}

type Engine = ReturnType<typeof fakeEngine>;
const playback = (engine: Engine) => engine.state.show.changes(0)!.playback!;
const lastDoc = (engine: Engine) => {
  const message = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
  return message.doc;
};
/** Rojo, verde y azul del PAR #1 (dirección 33) tal como salen por el cable. */
const par1 = (engine: Engine) => engine.state.show.frame(1).slice(33, 36);

describe("Color fijo", () => {
  it("tapa los colores del momento y de sus effects, y al soltarlo vuelven", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: /^Hora loca$/ }));
    await waitFor(() => expect(playback(engine).runningEffectIds.length).toBeGreaterThan(0));

    const colors = within(screen.getByRole("region", { name: "Color fijo" }));
    await user.click(colors.getByRole("button", { name: "PAR: Rojo" }));
    await waitFor(() => expect(colors.getByRole("button", { name: "PAR: Rojo" })).toHaveAttribute("aria-pressed", "true"));
    expect(par1(engine)).toEqual([255, 0, 0]);
    // El arcoíris sigue por debajo y el momento no cambió.
    expect(playback(engine).runningEffectIds.length).toBeGreaterThan(0);
    const before = JSON.stringify(lastDoc(engine).scenes);

    await user.click(colors.getByRole("button", { name: "PAR: Del momento" }));
    await waitFor(() => expect(playback(engine).heldColors).toEqual({}));
    expect(JSON.stringify(lastDoc(engine).scenes)).toBe(before);
  });

  it("en la vista previa se prueba sin tocar las luces y después se manda", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Escenario" }));
    await user.click(screen.getByRole("button", { name: "Vista previa" }));
    await screen.findByText("VISTA PREVIA");
    await user.click(screen.getByRole("button", { name: "Vals" }));
    await user.click(screen.getByRole("button", { name: "PAR: Azul" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "PAR: Azul" })).toHaveAttribute("aria-pressed", "true"));
    expect(playback(engine).activeMomentId).toBeNull();
    expect(playback(engine).heldColors).toEqual({});

    await user.click(screen.getByRole("button", { name: "Mandar a las luces" }));
    await waitFor(() => expect(playback(engine).heldColors).not.toEqual({}));
    const vals = lastDoc(engine).moments.find((m) => m.name === "Vals")!;
    expect(playback(engine).activeMomentId).toBe(vals.id);
    expect(screen.queryByText("VISTA PREVIA")).toBeNull();
  });
});

describe("Color de un momento", () => {
  it("se guarda en su escena y avisa si un effect de color lo tapa", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Entrada" }));
    await user.click(screen.getByRole("button", { name: "Entrada, PAR: Rojo" }));
    expect(screen.getByRole("button", { name: "Entrada, PAR: Rojo" })).toHaveAttribute("aria-pressed", "true");
    const doc = lastDoc(engine);
    const entrada = doc.moments.find((m) => m.name === "Entrada")!;
    const scene = doc.scenes.find((s) => s.id === entrada.sceneId)!;
    const par = doc.instances.find((i) => i.label === "LPC007 PAR #1")!;
    const channels = doc.definitions.find((d) => d.id === par.definitionId)!.channels;
    const valueOf = (type: string) => scene.values[par.id][channels.find((c) => c.type === type)!.id];
    expect([valueOf("RED"), valueOf("GREEN"), valueOf("BLUE")]).toEqual([255, 0, 0]);

    await user.click(screen.getByRole("button", { name: "Hora loca" }));
    await user.click(screen.getByRole("button", { name: "Quitarlos de este momento" }));
    const horaLoca = lastDoc(engine).moments.find((m) => m.name === "Hora loca")!;
    expect(horaLoca.effectIds.length).toBe(1); // queda el movimiento de las cabezas
  });
});

describe("Ajustes del efecto en Escenario", () => {
  it("al tocar un efecto se prende y a la derecha se le cambian los colores y la velocidad, y llega a las luces", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Escenario" }));
    await user.click(screen.getByRole("button", { name: /^PAR/, expanded: false }));
    await user.click(screen.getByRole("button", { name: "PAR: policía" }));
    const id = lastDoc(engine).effects.find((fx) => fx.name === "PAR: policía")!.id;
    await waitFor(() => expect(playback(engine).runningEffectIds).toContain(id));

    const panel = () => within(screen.getByRole("region", { name: "Ajustes de PAR: policía" }));
    await user.click(panel().getByRole("button", { name: "Color: Verde" }));
    await user.click(panel().getByRole("button", { name: "Segundo color: Amarillo" }));
    fireEvent.change(panel().getByRole("slider", { name: /Velocidad/ }).parentElement!.querySelector("input")!, {
      target: { value: "20" },
    });
    expect(lastDoc(engine).effects.find((fx) => fx.id === id)).toMatchObject({ color: "#00ff00", color2: "#ffff00", speedCpm: 20 });
    // Por el cable: el PAR #1 en verde o en amarillo, nunca en el rojo de antes.
    await waitFor(() => expect([[0, 255, 0], [255, 255, 0]]).toContainEqual([...par1(engine)]));

    // Una ola de brillo con su color: "Ola" en azul.
    await user.click(screen.getByRole("button", { name: "PAR: ola" }));
    await user.click(within(screen.getByRole("region", { name: "Ajustes de PAR: ola" })).getByRole("button", { name: "Color: Azul" }));
    expect(lastDoc(engine).effects.find((fx) => fx.name === "PAR: ola")!.color).toBe("#0000ff");
  });

  it("si el Color fijo pinta el efecto, elegir un color en sus ajustes lo suelta para que se vea", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Escenario" }));
    await user.click(screen.getByRole("button", { name: /^PAR/, expanded: false }));
    await user.click(screen.getByRole("button", { name: "PAR: ida y vuelta" }));
    await user.click(screen.getByRole("button", { name: "PAR: Rojo" }));
    await waitFor(() => expect(playback(engine).heldColors).not.toEqual({}));
    const panel = within(screen.getByRole("region", { name: "Ajustes de PAR: ida y vuelta" }));
    expect(await panel.findByText(/El Color fijo de PAR \(rojo\) está pintando este efecto/)).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Color: Cian" }));
    await waitFor(() => expect(playback(engine).heldColors).toEqual({}));
  });
});

describe("Lo que se mueve solo", () => {
  it("arriba se ve qué efectos corren y de qué momento, y Detener los para desde cualquier sección", async () => {
    const { user, engine } = await withTemplate();
    const top = () => within(screen.getByRole("banner"));
    expect(top().queryByRole("button", { name: "■ Detener" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: /^Hora loca$/ }));
    await waitFor(() => expect(top().getByText(/efectos/)).toHaveTextContent("del momento «Hora loca»"), { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: "Dashboard" }));
    await user.click(top().getByRole("button", { name: "■ Detener" }));
    await waitFor(() => expect(playback(engine).runningEffectIds).toEqual([]));
    await waitFor(() => expect(top().queryByRole("button", { name: "■ Detener" })).toBeNull());
  });
});

describe("Efectos listos", () => {
  it("se cargan solos en cada grupo una sola vez, por tipo de luz, y los borrados no vuelven", async () => {
    const { user, engine } = await withTemplate();
    await waitFor(() => expect(lastDoc(engine).effects.length).toBeGreaterThan(50));
    const names = () => lastDoc(engine).effects.map((fx) => fx.name);
    expect(names()).toEqual(expect.arrayContaining(["PAR: policía", "PAR: fuego", "Cabezas: tijeras", "Cabezas: ballyhoo"]));
    // Las cabezas de ejemplo no tienen RGB: sin efectos de color de PAR.
    expect(names()).not.toContain("Cabezas: policía");
    // Ninguno repetido con los de la plantilla.
    expect(new Set(names()).size).toBe(names().length);

    await user.click(screen.getByRole("button", { name: "Effects" }));
    expect(screen.queryByRole("button", { name: /Cargar los que faltan/ })).toBeNull();
    const total = names().length;
    willAnswer(true);
    await user.click(within(screen.getByRole("button", { name: /^PAR: policía/ }).parentElement!).getByTitle("Borrar effect"));
    expect(names()).toHaveLength(total - 1);
    await user.click(screen.getByRole("button", { name: /Cargar los que faltan \(1\)/ }));
    expect(names()).toContain("PAR: policía");
  });

  it("se ven antes y se agregan para un grupo", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Effects" }));
    await user.click(screen.getByRole("button", { name: "+ Efectos listos" }));
    await user.selectOptions(screen.getByLabelText("Para"), "PAR");
    // Van por tipo de luz: abierto solo el del primero.
    expect(screen.getByRole("button", { name: /^PAR y luces de color/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: /^PersecuciónSe encienden/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cabezas móviles/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Brillo y estrobo/ }));
    await user.click(screen.getByRole("button", { name: /^PersecuciónSe encienden/ }));
    await user.click(screen.getByRole("button", { name: "Agregar “PAR: persecución”" }));
    const added = lastDoc(engine).effects.find((fx) => fx.name === "PAR: persecución")!;
    expect(added).toMatchObject({ channelType: "DIMMER", waveform: "square", phaseOffsetDeg: 90 });
    expect(screen.getByText("EFFECT — PAR: persecución")).toBeInTheDocument();
  });
});

describe("Luces en la misma dirección", () => {
  it("van juntas: lo que se le pone a una lo recibe la otra, y no es un choque", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Fixtures" }));
    await user.click(screen.getByRole("button", { name: /^LPC007/ }));
    const row = screen.getByRole("button", { name: /^LPC007 PAR #2/ }).parentElement!;
    fireEvent.change(within(row).getAllByRole("spinbutton")[1], { target: { value: "33" } });
    expect(screen.getByText("va junto con LPC007 PAR #1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "DMX Output" }));
    expect(screen.queryByText(/Se pisa con/)).toBeNull();
  });
});

describe("Live", () => {
  it("los faders de un grupo muestran lo que tienen las luces, también al volver", async () => {
    const { user } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: "Fotos" }));
    // Fotos pone los PAR en blanco: el verde ya está arriba.
    const groups = () => within(screen.getByText("GROUPS — MASTER").closest("section, div")!.parentElement!);
    const green = () => groups().getAllByRole("slider", { name: "Green" })[0];
    await waitFor(() => expect(green()).toHaveAttribute("aria-valuenow", "255"), { timeout: 4000 }); // Fotos tarda 1 s
    fireEvent.change(green().parentElement!.querySelector("input")!, { target: { value: "0" } });
    await waitFor(() => expect(green()).toHaveAttribute("aria-valuenow", "0"));
    await user.click(screen.getByRole("button", { name: "Escenario" }));
    await user.click(screen.getByRole("button", { name: "Live" }));
    expect(green()).toHaveAttribute("aria-valuenow", "0");
  });

  it("lo que se cambió en vivo se guarda en el momento", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: "Fotos" }));
    await user.click(within(screen.getByRole("region", { name: "Color fijo" })).getByRole("button", { name: "PAR: Rojo" }));
    await waitFor(() => expect(playback(engine).heldColors).not.toEqual({}));
    await user.click(screen.getByRole("button", { name: "Guardar cambios en «Fotos»" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Guardar" }));
    const doc = lastDoc(engine);
    const fotos = doc.moments.find((m) => m.name === "Fotos")!;
    const scene = doc.scenes.find((s) => s.id === fotos.sceneId)!;
    const par = doc.instances.find((i) => i.label === "LPC007 PAR #1")!;
    const channels = doc.definitions.find((d) => d.id === par.definitionId)!.channels;
    const valueOf = (type: string) => scene.values[par.id][channels.find((c) => c.type === type)!.id];
    expect([valueOf("RED"), valueOf("GREEN"), valueOf("BLUE")]).toEqual([255, 0, 0]);
  });
});

describe("Shows de la 0.2", () => {
  it("un show de antes recibe los efectos listos de sus grupos al abrirlo, una sola vez", async () => {
    const { engine } = await withTemplate();
    const doc = lastDoc(engine);
    const old = { ...doc, effects: doc.effects.slice(0, 10) };
    cleanup();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(old));
    const again = fakeEngine();
    render(<App />);
    await waitFor(() => expect(lastDoc(again).effects.length).toBe(doc.effects.length));
    expect(localStorage.getItem("lumenpro.effects.catalog")).toBe(String(CATALOG_VERSION));
  });

  it("el golpe de graves de la plantilla vieja queda apagado sin música", async () => {
    const fx = { id: "g", name: "PAR: golpe de graves", source: "bass", min: 40, max: 255 };
    const mine = { ...fx, id: "m", name: "PAR: mío", min: 40 };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ definitions: [], instances: [], effects: [fx, mine] }));
    const engine = fakeEngine();
    render(<App />);
    const reset = await waitFor(() => {
      const found = engine.applied.find((m) => m.type === "reset");
      expect(found).toBeDefined();
      return found as Extract<EngineMessage, { type: "reset" }>;
    });
    expect(reset.doc.effects.map((e) => e.min)).toEqual([0, 40]);
  });
});

describe("Color fijo en las cabezas", () => {
  it("la rueda va al color elegido y con Estrobo destellan en ese color", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: /^Hora loca$/ }));
    const colors = within(screen.getByRole("region", { name: "Color fijo" }));
    await user.click(colors.getByRole("button", { name: "Cabezas: Rojo" }));
    await waitFor(() => expect(engine.state.show.frame(1)[7]).toBe(67)); // canal 8: rueda en "Rojo"
    await user.click(screen.getAllByRole("button", { name: "Estrobo" })[0]);
    await waitFor(() => expect(playback(engine).strobeActive).toBe(true));
    const frame = engine.state.show.frame(1);
    expect([frame[6], frame[7]]).toEqual([87, 67]); // obturador en estrobo, rueda en rojo
  });

  it("las cabezas de un show de la 0.2 reciben la rueda de colores", async () => {
    const head = { id: "def-orus-280", manufacturer: "Orus", model: "280W", verified: false, channels: [
      { id: "w", index: 1, name: "Color Wheel", type: "COLOR_WHEEL", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
    ] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ definitions: [head], instances: [] }));
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.applied.some((m) => m.type === "reset")).toBe(true));
    const reset = engine.applied.find((m) => m.type === "reset") as Extract<EngineMessage, { type: "reset" }>;
    expect(reset.doc.definitions[0].channels[0].presets.map((p) => p.label)).toContain("Rojo");
  });
});
