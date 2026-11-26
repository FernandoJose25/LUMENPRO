import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";

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

    await user.click(colors.getByRole("button", { name: "Del momento" }));
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

describe("Efectos listos", () => {
  it("se ven antes y se agregan para un grupo", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Effects" }));
    await user.click(screen.getByRole("button", { name: "+ Efectos listos" }));
    await user.selectOptions(screen.getByLabelText("Para"), "PAR");
    await user.click(screen.getByRole("button", { name: /^Persecución/ }));
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
