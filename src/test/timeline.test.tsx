import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { actionOptions, isActive } from "@/lib/actions";
import type { EngineMessage, Playback } from "@/types/engine";
import type { ShowDoc } from "@/lib/history";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));
// Decodificar audio no existe en jsdom: la canción es de mentira.
vi.mock("@/lib/songs", () => ({
  saveSong: vi.fn(async (file: File) => ({ file: "cancion-1.mp3", name: file.name })),
  songUrl: vi.fn(async () => "blob:cancion"),
  songShape: vi.fn(async () => ({ durationMs: 10_000, peaks: [0.4, 0.8, 0.2] })),
}));

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
  HTMLMediaElement.prototype.pause = pause as unknown as HTMLMediaElement["pause"];
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
});

type Engine = ReturnType<typeof fakeEngine>;
const playback = (engine: Engine) => engine.state.show.changes(0)!.playback!;
const lastDoc = (engine: Engine) => {
  const message = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
  return message.doc;
};

/** La plantilla de quinceañera (Recepción, Entrada, Vals…) y una línea de tiempo vacía. */
async function withVals() {
  const user = userEvent.setup();
  const engine = fakeEngine();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Momentos" }));
  await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
  await user.click(screen.getByRole("button", { name: "Línea de tiempo" }));
  await user.click(screen.getByRole("button", { name: "Crear la del vals" }));
  const moments = lastDoc(engine).moments;
  return { user, engine, first: moments[0], second: moments[1] };
}

/** Mueve la línea blanca de a un segundo. */
function forward(seconds: number) {
  const slider = screen.getByRole("slider", { name: "Posición en la canción" });
  for (let i = 0; i < seconds; i++) fireEvent.keyDown(slider, { key: "ArrowRight" });
}

const marks = () => within(screen.getByRole("group", { name: "Agregar marca" }));

describe("Línea de tiempo", () => {
  it("las marcas van donde está la línea blanca y al reproducir cada momento entra a su segundo", async () => {
    const { user, engine, first, second } = await withVals();
    await user.click(marks().getByRole("button", { name: "+ Momento" }));
    forward(2);
    // Sigue con el momento siguiente al que ya estaba puesto.
    await user.click(marks().getByRole("button", { name: "+ Momento" }));
    expect(screen.getByRole("button", { name: `0:00.0 ${first.name}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `0:02.0 ${second.name}` })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "⏮ Al inicio" }));
    await user.click(screen.getByRole("button", { name: "▶ Reproducir" }));
    await waitFor(() => expect(playback(engine).timeline).not.toBeNull());
    await waitFor(() => expect(playback(engine).activeMomentId).toBe(first.id));
    await waitFor(() => expect(playback(engine).activeMomentId).toBe(second.id), { timeout: 4000 });
    // Sin canción, las luces corren igual.
    expect(play).not.toHaveBeenCalled();
  });

  it("desde la mitad, las luces quedan como si hubiera sonado desde el principio", async () => {
    const { user, engine, first, second } = await withVals();
    // Sin canción terminaría en la última marca, antes del segundo 3.
    await user.upload(screen.getByLabelText("Canción"), new File(["x"], "vals.mp3", { type: "audio/mpeg" }));
    await screen.findByText("vals.mp3 · 0:10.0");
    await user.click(marks().getByRole("button", { name: "+ Momento" }));
    forward(2);
    await user.click(marks().getByRole("button", { name: "+ Momento" }));
    forward(1);
    await user.click(screen.getByRole("button", { name: "▶ Reproducir" }));
    await waitFor(() => expect(playback(engine).activeMomentId).toBe(second.id), { timeout: 1000 });
    expect(first.id).not.toBe(second.id);

    await user.click(screen.getByRole("button", { name: "❚❚ Pausa" }));
    await waitFor(() => expect(playback(engine).timeline?.pausedAt).not.toBeNull());
    await user.click(screen.getByRole("button", { name: "■ Detener" }));
    await waitFor(() => expect(playback(engine).timeline).toBeNull());
  });

  it("una marca se corre de segundo, cambia su duración y se borra", async () => {
    const { user, engine } = await withVals();
    await user.click(marks().getByRole("button", { name: "+ Estrobo" }));
    expect(screen.getByRole("textbox", { name: "Dura" })).toHaveValue("2");

    const second = screen.getByRole("textbox", { name: "Segundo" });
    await user.clear(second);
    await user.type(second, "1,5{Enter}");
    expect(screen.getByRole("button", { name: "0:01.5 Estrobo" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Después" }));
    expect(screen.getByRole("button", { name: "0:01.6 Estrobo" })).toBeInTheDocument();
    await waitFor(() => expect(lastDoc(engine).timelines[0].cues[0]).toMatchObject({ atMs: 1600, lengthMs: 2000 }));

    await user.click(screen.getByRole("button", { name: "Borrar marca" }));
    expect(screen.queryByRole("button", { name: /^\d:\d\d\.\d Estrobo$/ })).toBeNull();
  });

  it("con canción, suena al reproducir y se calla al detener", async () => {
    const { user, engine } = await withVals();
    await user.upload(screen.getByLabelText("Canción"), new File(["x"], "vals.mp3", { type: "audio/mpeg" }));
    expect(await screen.findByText("vals.mp3 · 0:10.0")).toBeInTheDocument();
    await waitFor(() => expect(lastDoc(engine).timelines[0]).toMatchObject({ durationMs: 10_000 }));

    await user.click(screen.getByRole("button", { name: "▶ Reproducir" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "■ Detener" }));
    await waitFor(() => expect(pause).toHaveBeenCalled());
    expect(playback(engine).timeline).toBeNull();
  });
});

describe("Botones del celular y MIDI", () => {
  it("pueden arrancar y detener una línea de tiempo", () => {
    const empty: ShowDoc = {
      definitions: [], instances: [], scenes: [], palettes: [], groups: [], chases: [], effects: [], moments: [],
      timelines: [{ id: "t", name: "Vals", song: null, durationMs: 0, cues: [] }], playlist: [], specials: [], livePads: [], phonePads: [],
      controls: [],
    };
    const idle: Playback = {
      activeSceneId: null, runningEffectIds: [], blackoutActive: false, master: 100, strobeActive: false, identifyId: null,
      activeMomentId: null, momentRun: null, chase: null, heldColors: {}, timeline: null, tapBpm: null, speed: 100, firing: {}, armed: {}, djBpm: null,
    };
    const option = actionOptions({ ...empty, ...idle }).find((o) => o.label === "Vals");
    expect(option).toMatchObject({ group: "Líneas de tiempo (arranca / detiene)", action: { do: "timeline", id: "t" } });
    const playing = { ...empty, ...idle, timeline: { id: "t", startedAt: 0, pausedAt: null } };
    expect(isActive(option!.action, playing)).toBe(true);
  });
});
