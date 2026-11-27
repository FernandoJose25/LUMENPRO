import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { EFFECT_PRESETS, groupHas, groupHasPixels } from "@/lib/effectPresets";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import { fakeEngine } from "./fakeEngine";
import { willAnswer } from "./dialogs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Barras y tiras de LEDs", () => {
  it("una tira WLED se arma con un punto RGB por LED, uno tras otro", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Fixtures" }));
    willAnswer("30");
    await user.click(screen.getByRole("button", { name: "+ Tira de LEDs (WLED)" }));
    await waitFor(() => {
      const doc = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
      const strip = doc.doc.definitions.find((d) => d.manufacturer === "WLED")!;
      expect(strip.channels).toHaveLength(90);
      expect(strip.heads).toHaveLength(30);
      expect(strip.channels.slice(0, 3).map((c) => c.type)).toEqual(["RED", "GREEN", "BLUE"]);
    });
    expect(screen.getByText(/TIRA DE LEDS \(30 PUNTOS\)/)).toBeInTheDocument();
  });

  it("los efectos listos de píxeles solo se ofrecen a grupos con barras o tiras", () => {
    const strip = { ...seedDefinitions[1], id: "strip", heads: [["a"], ["b"]] };
    const rig = {
      definitions: [...seedDefinitions, strip],
      instances: [
        ...seedInstances.map((i) => ({ ...i, group: "pars" })),
        { ...seedInstances[2], id: "s1", definitionId: "strip", group: "tiras" },
      ],
    };
    const pixelPresets = EFFECT_PRESETS.filter((p) => p.pixels);
    expect(pixelPresets.length).toBeGreaterThanOrEqual(4);
    expect(groupHasPixels(rig, "pars")).toBe(false);
    expect(groupHasPixels(rig, "tiras")).toBe(true);
    expect(groupHas(rig, "tiras", "RED")).toBe(true);
  });
});
