import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

const playback = (engine: ReturnType<typeof fakeEngine>) => engine.state.show.changes(0)!.playback!;
const lastDoc = (engine: ReturnType<typeof fakeEngine>) => {
  const message = [...engine.applied].reverse().find((m) => m.type === "doc") as Extract<EngineMessage, { type: "doc" }>;
  return message.doc;
};

async function pick(user: ReturnType<typeof userEvent.setup>, select: HTMLElement, label: string) {
  // Momentos van antes que las escenas del mismo nombre.
  const option = within(select).getAllByRole("option", { name: label })[0] as HTMLOptionElement;
  await user.selectOptions(select, option.value);
}

describe("Live a medida", () => {
  it("se arman, ordenan y agrandan botones, y hacen lo suyo", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    const board = within(screen.getByRole("region", { name: "Mis botones" }));
    await user.click(board.getByRole("button", { name: "Editar" }));
    for (const label of ["Vals", "Blackout (enciende / apaga)", "Estrobo (mientras se aprieta)", "Intensidad general (fader)"]) {
      await pick(user, board.getByLabelText("Qué hace el botón nuevo"), label);
      await user.click(board.getByRole("button", { name: "+ Botón" }));
    }
    await user.click(board.getByRole("button", { name: "Mover Blackout (enciende / apaga) antes" }));
    await user.click(board.getByRole("button", { name: "Agrandar Vals" }));
    await user.click(board.getByRole("button", { name: "Quitar Estrobo (mientras se aprieta)" }));
    await user.click(board.getByRole("button", { name: "Listo" }));

    const names = board.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Editar", "Blackout (enciende / apaga)", "Vals", "−", "+"]); // y el fader
    expect(lastDoc(engine).livePads.map((p) => [p.label, p.size])).toEqual([
      ["Blackout (enciende / apaga)", 1],
      ["Vals", 2],
      ["Intensidad general (fader)", 1],
    ]);

    await user.click(board.getByRole("button", { name: "Vals" }));
    await waitFor(() => expect(board.getByRole("button", { name: "Vals" })).toHaveAttribute("aria-pressed", "true"));
    await user.click(board.getByRole("button", { name: "Blackout (enciende / apaga)" }));
    await waitFor(() => expect(playback(engine).blackoutActive).toBe(true));
    fireEvent.change(board.getByRole("spinbutton"), { target: { value: "40" } });
    await waitFor(() => expect(playback(engine).master).toBe(40));
  }, 60_000); // es largo: con la PC ocupada pasa de 20 s

  it("el estrobo dura lo que se aprieta", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Live" }));
    const board = within(screen.getByRole("region", { name: "Mis botones" }));
    await user.click(board.getByRole("button", { name: "Editar" }));
    await pick(user, board.getByLabelText("Qué hace el botón nuevo"), "Estrobo (mientras se aprieta)");
    await user.click(board.getByRole("button", { name: "+ Botón" }));
    await user.click(board.getByRole("button", { name: "Listo" }));
    const strobe = board.getByRole("button", { name: "Estrobo (mientras se aprieta)" });
    fireEvent.pointerDown(strobe);
    await waitFor(() => expect(playback(engine).strobeActive).toBe(true));
    fireEvent.pointerUp(strobe);
    await waitFor(() => expect(playback(engine).strobeActive).toBe(false));
  });
});

describe("Celular a medida", () => {
  it("los botones del celular se guardan con el show", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Celular" }));
    await pick(user, screen.getByLabelText("Qué hace el botón nuevo"), "Siguiente momento");
    await user.click(screen.getByRole("button", { name: "+ Botón" }));
    await waitFor(() => expect(lastDoc(engine).phonePads.map((p) => p.label)).toEqual(["Siguiente momento"]));
    // Lo que el celular ve y aprieta lo resuelve el motor (show-engine/tests).
  });
});

describe("MIDI", () => {
  it("aprender: elegir qué hará y mover el control", async () => {
    const { user, engine } = await withTemplate();
    engine.state.midi = { devices: ["APC mini"], last: null };
    await user.click(screen.getByRole("button", { name: "MIDI" }));
    expect(await screen.findByText("APC mini")).toBeInTheDocument();
    await pick(user, screen.getByLabelText("Qué hará el control"), "Hora loca");
    await user.click(screen.getByRole("button", { name: "Aprender" }));
    expect(screen.getByRole("button", { name: /Mueve el botón o fader/ })).toBeInTheDocument();
    act(() => {
      engine.state.midi = {
        devices: ["APC mini"],
        last: { device: "APC mini", kind: "note", channel: 0, number: 56, value: 127, seq: 1 },
      };
    });
    expect(await screen.findByText("Botón (nota) 56 · canal 1")).toBeInTheDocument();
    await waitFor(() =>
      expect(lastDoc(engine).controls).toEqual([
        expect.objectContaining({ device: "APC mini", kind: "note", channel: 0, number: 56, action: expect.objectContaining({ do: "moment" }) }),
      ]),
    );
    await user.click(screen.getByRole("button", { name: "Quitar Botón (nota) 56 · canal 1" }));
    expect(screen.queryByText("Botón (nota) 56 · canal 1")).not.toBeInTheDocument();
  });

  it("en el navegador lo explica", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "MIDI" }));
    expect(screen.getByText(/funcionan en la app de escritorio/)).toBeInTheDocument();
  });
});
