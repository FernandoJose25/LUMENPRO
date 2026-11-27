import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

type Engine = ReturnType<typeof fakeEngine>;
const tapBpm = (engine: Engine) => engine.state.show.changes(0)!.playback!.tapBpm;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Tap", () => {
  it("dos toques arriba marcan el tempo, se ve al lado y × lo suelta", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    // El motor recibe el show recién al saludar: lo de antes se borraría.
    await waitFor(() => expect(engine.applied.some((m) => m.type === "reset")).toBe(true));
    const tap = screen.getByRole("button", { name: "Tap: marcar el ritmo" });
    // Cuenta al apretar, no al soltar (user.click no lo dispara en jsdom).
    fireEvent.pointerDown(tap);
    await sleep(500);
    fireEvent.pointerDown(tap);
    await waitFor(() => expect(tapBpm(engine)).not.toBeNull());
    expect(tapBpm(engine)!).toBeGreaterThan(100);
    expect(tapBpm(engine)!).toBeLessThan(140);
    expect(await screen.findByText(/^\d+ BPM a mano$/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Soltar el ritmo" }));
    await waitFor(() => expect(tapBpm(engine)).toBeNull());
    expect(screen.queryByText(/BPM a mano/)).toBeNull();
  });

  it("la tecla T también marca, salvo escribiendo", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Momentos" }));
    await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
    const name = screen.getAllByRole("textbox")[0];
    fireEvent.keyDown(name, { key: "t" });
    await sleep(400);
    fireEvent.keyDown(name, { key: "t" });
    await sleep(50);
    expect(tapBpm(engine)).toBeNull();

    fireEvent.keyDown(window, { key: "t" });
    await sleep(400);
    fireEvent.keyDown(window, { key: "T" });
    await waitFor(() => expect(tapBpm(engine)).not.toBeNull());
  });
});
