import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));
// Decodificar audio no existe en jsdom: el análisis es de mentira.
vi.mock("@/lib/songs", () => ({
  saveSong: vi.fn(async (file: File) => ({ file: `cancion-${file.name}`, name: file.name })),
  songUrl: vi.fn(async (song: { file: string }) => `blob:${song.file}`),
  songShape: vi.fn(async (song: { file: string }) => ({
    durationMs: 180_000,
    peaks: [],
    grid: song.file.includes("reggaeton") ? { bpm: 96, firstBeatMs: 250 } : null,
  })),
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
const beatsSent = (engine: Engine) =>
  engine.applied.filter((m): m is Extract<EngineMessage, { type: "audio" }> => m.type === "audio").map((m) => m.audio?.beat?.bpm ?? null);

async function withSongs() {
  const user = userEvent.setup();
  const engine = fakeEngine();
  render(<App />);
  await waitFor(() => expect(engine.applied.some((m) => m.type === "reset")).toBe(true));
  await user.click(screen.getByRole("button", { name: "Música" }));
  await user.upload(screen.getByLabelText("Canciones"), [
    new File(["x"], "reggaeton.mp3", { type: "audio/mpeg" }),
    new File(["x"], "balada.mp3", { type: "audio/mpeg" }),
  ]);
  const list = within(screen.getByRole("list", { name: "Lista de canciones" }));
  await waitFor(() => expect(list.getAllByRole("listitem")).toHaveLength(2));
  return { user, engine, list };
}

describe("Música", () => {
  it("cada canción llega con su tempo; al ponerla, las luces reciben su golpe sin micrófono", async () => {
    const { user, engine, list } = await withSongs();
    expect(list.getByText("96 BPM")).toBeInTheDocument();
    expect(list.getByText("sin ritmo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Poner reggaeton.mp3" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    await waitFor(() => expect(beatsSent(engine)).toContain(96));
    expect(within(screen.getByRole("banner")).getByText("96 BPM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "❚❚ Pausa" }));
    expect(pause).toHaveBeenCalled();
  });

  it("al terminar una canción pasa sola a la siguiente", async () => {
    const { user } = await withSongs();
    await user.click(screen.getByRole("button", { name: "Poner reggaeton.mp3" }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    const element = play.mock.contexts[0] as HTMLAudioElement;
    element.dispatchEvent(new Event("ended"));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Poner balada.mp3" })).toHaveTextContent("♪"));
  });

  it("½ y ×2 corrigen un tempo que quedó al doble o a la mitad", async () => {
    const { user, list } = await withSongs();
    await user.click(screen.getByRole("button", { name: "Doble del tempo de reggaeton.mp3" }));
    expect(list.getByText("192 BPM")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mitad del tempo de reggaeton.mp3" }));
    expect(list.getByText("96 BPM")).toBeInTheDocument();
  });

  it("al arrancar el vals la música se pausa sola", async () => {
    const { user } = await withSongs();
    await user.click(screen.getByRole("button", { name: "Poner reggaeton.mp3" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    pause.mockClear();
    await user.click(screen.getByRole("button", { name: "Línea de tiempo" }));
    await user.click(screen.getByRole("button", { name: "Crear la del vals" }));
    await user.click(screen.getByRole("button", { name: "+ Estrobo" }));
    await user.click(screen.getByRole("button", { name: "▶ Reproducir" }));
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });
});
