import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const playback = (engine: Engine) => engine.state.show.changes(0)!.playback!;

describe("Efectos especiales", () => {
  it("las chispas se arman y disparan solo mientras se aprieta", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.applied.some((m) => m.type === "reset")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Live" }));
    const box = () => within(screen.getByRole("region", { name: "Efectos especiales" }));
    await user.click(box().getByRole("button", { name: "Agregar humo, chispas…" }));
    await user.click(box().getByRole("button", { name: "+ Chispas frías" }));
    // Sin máquina de efectos en el rig queda sin asignar: no toca ninguna luz.
    const machine = box().getByRole("combobox", { name: "Máquina de Chispas frías" });
    expect(machine).toHaveValue("");
    await user.click(box().getByRole("button", { name: "Listo" }));
    expect(box().getByRole("button", { name: "Mantener: Chispas frías" })).toBeDisabled();
    await user.click(box().getByRole("button", { name: "Configurar" }));
    await user.selectOptions(box().getByRole("combobox", { name: "Máquina de Chispas frías" }), "LPC007 PAR #4");
    expect(box().getByText(/es una luz/)).toBeInTheDocument();
    await user.click(box().getByRole("button", { name: "Listo" }));

    const fire = box().getByRole("button", { name: "Mantener: Chispas frías" });
    expect(fire).toBeDisabled();
    await user.click(box().getByRole("button", { name: "Armar Chispas frías" }));
    await waitFor(() => expect(Object.keys(playback(engine).armed)).toHaveLength(1));
    await waitFor(() => expect(fire).toBeEnabled());
    expect(box().getByRole("button", { name: "Armar Chispas frías" })).toHaveTextContent(/ARMADO \d:\d\d/);

    fireEvent.pointerDown(fire);
    await waitFor(() => expect(Object.keys(playback(engine).firing)).toHaveLength(1));
    fireEvent.pointerUp(fire);
    await waitFor(() => expect(playback(engine).firing).toEqual({}));
  });

  it("el haze se prende con un toque y se apaga con otro", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.applied.some((m) => m.type === "reset")).toBe(true));
    await user.click(screen.getByRole("button", { name: "Live" }));
    const box = () => within(screen.getByRole("region", { name: "Efectos especiales" }));
    await user.click(box().getByRole("button", { name: "Agregar humo, chispas…" }));
    await user.click(box().getByRole("button", { name: "+ Haze" }));
    await user.selectOptions(box().getByRole("combobox", { name: "Máquina de Haze" }), "LPC007 PAR #4");
    await user.click(box().getByRole("button", { name: "Listo" }));
    await user.click(box().getByRole("button", { name: "Haze: prender" }));
    await waitFor(() => expect(Object.keys(playback(engine).firing)).toHaveLength(1));
    await user.click(await box().findByRole("button", { name: "Haze: apagar" }));
    await waitFor(() => expect(playback(engine).firing).toEqual({}));
  });
});
