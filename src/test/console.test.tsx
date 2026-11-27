import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";
import { willAnswer } from "./dialogs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Consola del celular", () => {
  it("los botones van por páginas y con color", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Celular" }));
    const board = within(await screen.findByText("BOTONES DEL CELULAR").then((t) => t.closest("div.flex.h-full")! as HTMLElement));
    await user.click(board.getByRole("button", { name: "+ Botón" }));
    willAnswer("Fiesta");
    await user.click(board.getByRole("button", { name: "+ Página" }));
    expect(board.getByRole("tab", { name: "Fiesta" })).toHaveAttribute("aria-selected", "true");
    await user.click(board.getByRole("button", { name: "+ Botón" }));
    const colors = board.getAllByRole("combobox", { name: /^Color de / });
    await user.selectOptions(colors[0], "Rojo");

    await waitFor(() => {
      const doc = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
      const pads = doc.doc.phonePads;
      expect(pads.map((p) => p.page ?? "")).toEqual(["", "Fiesta"]);
      expect(pads[1].color).toBe("#ef4444");
    });
    // En la primera página sigue solo el primero.
    await user.click(board.getByRole("tab", { name: "Principal" }));
    expect(board.getAllByRole("combobox", { name: /^Color de / })).toHaveLength(1);
  });
});
