import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { enqueue, prepareEngine } from "@/lib/engineLink";
import { STORAGE_KEY } from "@/lib/showFile";
import type { EngineMessage, Session } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

afterEach(async () => {
  // Que no quede un saludo viejo para el test siguiente.
  fakeEngine();
  await prepareEngine();
});

const types = (messages: EngineMessage[]) => messages.map((m) => m.type);

describe("Cola de órdenes", () => {
  const queue = (...messages: EngineMessage[]) => {
    const q: EngineMessage[] = [];
    messages.forEach((m) => enqueue(q, m));
    return q;
  };

  it("junta los movimientos seguidos y se queda con el último valor", () => {
    const value = (channel: string, v: number): EngineMessage => ({ type: "values", values: { a: { [channel]: v } } });
    expect(queue(value("x", 1), value("y", 2), value("x", 3))).toEqual([
      { type: "values", values: { a: { x: 3, y: 2 } } },
    ]);
  });

  it("no cambia el orden con lo que va en medio: un momento entre dos faders", () => {
    const value: EngineMessage = { type: "values", values: { a: { x: 1 } } };
    expect(types(queue(value, { type: "startMoment", id: "m" }, value))).toEqual(["values", "startMoment", "values"]);
  });

  it("dos veces Siguiente son dos veces", () => {
    const next: EngineMessage = { type: "stepMoment", direction: 1 };
    expect(queue(next, next)).toHaveLength(2);
  });

  it("del audio solo importa lo último", () => {
    const audio = (bass: number): EngineMessage => ({
      type: "audio",
      audio: { levels: { bass, mid: 0, treble: 0 }, beat: null },
    });
    expect(queue(audio(0.1), { type: "master", value: 5 }, audio(0.9))).toEqual([{ type: "master", value: 5 }, audio(0.9)]);
  });
});

describe("Un fader que se mueve", () => {
  it("no salta hacia atrás con lo que el motor decía antes de enterarse", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    const engine = fakeEngine({
      send: async (r) => {
        if (held) await gate;
        return engine.commands.send(r as never);
      },
    });
    render(<App />);
    await waitFor(() => expect(engine.frame()[0]).toBe(128));
    const pan = () => screen.getAllByRole("spinbutton")[0];

    held = true;
    await user.click(screen.getByRole("button", { name: "Aumentar Pan" }));
    // Mientras, el motor avisa de un valor viejo de ese mismo canal.
    const [instanceId, channelId] = [
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").instances?.[0]?.id ?? "inst-orus-1",
      "ch-1",
    ];
    await act(async () => {
      engine.show.send({ type: "values", values: { [instanceId]: { [channelId]: 5 } } }, Date.now());
      engine.changed();
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(pan()).toHaveValue(129);

    held = false;
    await act(async () => release());
    await waitFor(() => expect(engine.frame()[0]).toBe(129));
    expect(pan()).toHaveValue(129);
  });
});

/** Un show en marcha, con un momento lanzado, tal como lo devuelve el motor. */
async function runningSession(): Promise<Session> {
  const engine = fakeEngine();
  const view = render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Momentos" }));
  await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
  await user.click(screen.getByRole("button", { name: "Live" }));
  await user.click(screen.getByRole("region", { name: "Momentos" }).querySelectorAll("button")[8]);
  await waitFor(() => expect(engine.show.changes(0)!.playback!.runningEffectIds.length).toBeGreaterThan(0), {
    timeout: 5000,
  });
  const { values, playback } = engine.show.changes(0)!;
  const doc = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
  view.unmount();
  return { doc: doc.doc, live: values, playback: playback! };
}

describe("La ventana se cae y se vuelve a abrir", () => {
  it("muestra el show que seguía en marcha y no lo toca", async () => {
    const session = await runningSession();
    localStorage.clear(); // lo último no alcanzó a guardarse en disco

    const engine = fakeEngine();
    engine.state.session = session;
    localStorage.setItem("lumenpro.dmx.last", JSON.stringify({ adapter: "mock", port: "", fps: 30 }));
    await prepareEngine();
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "Siguiente: Hora loca + estrobo ▶" })).toBeInTheDocument();
    await waitFor(() => expect(engine.sent("wait").length).toBeGreaterThan(2));
    expect(types(engine.applied)).toEqual([]); // ni reset ni nada que mueva luces
    expect(engine.sent("connect")).toEqual([]); // reconectar cortaría la señal
  });
});

describe("El motor se cae y el guardián lo levanta", () => {
  it("si retomó el show, solo se le manda lo programado", async () => {
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.sent("wait").length).toBeGreaterThan(1));
    engine.applied.length = 0;
    engine.crash({ doc: {}, live: {}, playback: {} } as unknown as Session);
    await waitFor(() => expect(types(engine.applied)).toEqual(["doc"]), { timeout: 3000 });
  });

  it("si no, se le manda el show entero", async () => {
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.sent("wait").length).toBeGreaterThan(1));
    engine.applied.length = 0;
    engine.crash(null);
    await waitFor(() => expect(types(engine.applied)).toEqual(["reset"]), { timeout: 3000 });
    expect(engine.state.show.frame(1)[32]).toBe(255);
  });

  it("mientras no contesta avisa, y las órdenes llegan cuando vuelve, una sola vez", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = false;
    const engine = fakeEngine();
    const answer = vi.mocked(invoke).getMockImplementation()!;
    vi.mocked(invoke).mockImplementation(async (cmd, args) => {
      if (down && cmd === "engine_call") throw "El motor de luces no responde";
      return answer(cmd, args);
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(engine.sent("wait").length).toBeGreaterThan(1));

    down = true;
    await user.click(screen.getByRole("button", { name: "Estrobo" }));
    expect(await screen.findByText("Reconectando…", {}, { timeout: 3000 })).toBeInTheDocument();
    down = false;
    await waitFor(() => expect(engine.show.changes(0)!.playback!.strobeActive).toBe(true), { timeout: 3000 });
    expect(types(engine.applied).filter((t) => t === "strobe")).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe("Cerrar la ventana con las luces encendidas", () => {
  it.each([
    ["Dejar las luces y cerrar", true],
    ["Apagar todo y salir", false],
  ])("%s", async (option, keepLights) => {
    const engine = fakeEngine();
    await prepareEngine();
    render(<App />);
    await act(async () => engine.state.events!.onmessage({ type: "closeAsked" }));
    expect(screen.getByRole("dialog", { name: "Las luces están encendidas" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: option }));
    expect(invoke).toHaveBeenCalledWith("close_window", { keepLights });
  });

  it("Cancelar no cierra nada", async () => {
    const engine = fakeEngine();
    await prepareEngine();
    render(<App />);
    await act(async () => engine.state.events!.onmessage({ type: "closeAsked" }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });
});

describe("Abrir el programa dos veces", () => {
  it("la ventana que ya estaba pasa al frente", async () => {
    const engine = fakeEngine();
    render(<App />);
    engine.state.focus = true;
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("focus_window"));
  });
});
