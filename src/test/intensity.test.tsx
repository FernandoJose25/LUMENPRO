import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { createIntensityDetector } from "@/lib/intensity";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

/** Repetibles: con Math.random el test fallaría cada tanto. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("Intensidad de la música (de sound-to-light-osc)", () => {
  const rand = random(11);
  /** `seconds` de música con ese flujo, con temblor. */
  const play = (d: ReturnType<typeof createIntensityDetector>, flux: number, seconds: number) => {
    for (let i = 0; i < seconds * 50; i++) d.push(flux * (0.9 + rand() * 0.2), false);
  };

  it("nada hasta oír 5 segundos; después normal, intensa con el coro y calmada en la parte suave", () => {
    const d = createIntensityDetector();
    play(d, 100, 4);
    expect(d.intensity()).toBeNull();
    play(d, 100, 30);
    expect(d.intensity()).toBe(0);
    play(d, 170, 0.8);
    expect(d.intensity()).toBe(0); // espera un segundo antes de cambiar
    play(d, 170, 1.5);
    expect(d.intensity()).toBe(1);
    play(d, 100, 3);
    expect(d.intensity()).toBe(0);
    play(d, 50, 3);
    expect(d.intensity()).toBe(-1);
  });

  it("los silencios (una pausa) no cuentan ni cambian nada", () => {
    const d = createIntensityDetector();
    play(d, 100, 20);
    for (let i = 0; i < 500; i++) d.push(0, true);
    expect(d.intensity()).toBe(0);
  });
});

describe("Piloto automático en el Escenario", () => {
  it("sabe qué momentos de la plantilla van con cada música, se prende y se apaga desde arriba", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Momentos" }));
    await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
    await user.click(screen.getByRole("button", { name: "Escenario" }));
    await user.click(screen.getByRole("button", { name: "Ajustar" }));
    const panel = within(screen.getByRole("region", { name: "Piloto automático" }));
    expect(panel.getByRole("button", { name: "Calmada: Hora loca" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByRole("button", { name: "Normal: Hora loca con música" })).toHaveAttribute("aria-pressed", "true");
    expect(panel.getByRole("button", { name: "Intensa: Hora loca + estrobo" })).toHaveAttribute("aria-pressed", "true");
    await user.click(panel.getByRole("button", { name: "Intensa: Hora loca con música" }));
    expect(panel.getByRole("button", { name: "Intensa: Hora loca con música" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Piloto automático" }));
    const playback = () => engine.state.show.changes(0)!.playback!;
    await waitFor(() => expect(playback().autopilotOn).toBe(true));
    await user.click(await screen.findByRole("button", { name: "■ Apagar" }));
    await waitFor(() => expect(playback().autopilotOn).toBe(false));
  });
});
