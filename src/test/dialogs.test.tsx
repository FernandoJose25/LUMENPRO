import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "@/App";
import { askChoice, askConfirm, askText } from "@/lib/dialogs";

beforeEach(() => {
  localStorage.clear();
  render(<App />);
});

const dialog = () => screen.getByRole("dialog");

describe("Diálogos dentro del programa", () => {
  it("escribir un nombre y Enter lo acepta, sin espacios a los lados", async () => {
    const accept = vi.fn();
    act(() => askText("Nombre del grupo", "Grupo 1", accept));
    const user = userEvent.setup();
    expect(within(dialog()).getByRole("textbox")).toHaveFocus();
    await user.keyboard("  Cabezas {Enter}"); // lo propuesto queda seleccionado: se reemplaza
    expect(accept).toHaveBeenCalledExactlyOnceWith("Cabezas");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape, Cancelar y tocar fuera no hacen nada", async () => {
    const accept = vi.fn();
    const user = userEvent.setup();
    const ways = [
      () => user.keyboard("{Escape}"),
      () => user.click(within(dialog()).getByRole("button", { name: "Cancelar" })),
      // Con userEvent los paneles redimensionables se quedan el clic: en jsdom
      // todo mide 0 y parece caer sobre un separador.
      async () => void fireEvent.mouseDown(dialog().parentElement!),
    ];
    for (const close of ways) {
      act(() => askText("Nombre", "x", accept));
      await close();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(accept).not.toHaveBeenCalled();
  });

  it("al confirmar un borrado el foco empieza en Cancelar, para que Enter no borre por error", async () => {
    const accept = vi.fn();
    act(() => askConfirm("¿Borrar?", "Borrar", accept));
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    expect(accept).not.toHaveBeenCalled();
    act(() => askConfirm("¿Borrar?", "Borrar", accept));
    await user.click(within(dialog()).getByRole("button", { name: "Borrar" }));
    expect(accept).toHaveBeenCalledOnce();
  });

  it("un diálogo puede abrir otro, que empieza limpio", async () => {
    const second = vi.fn();
    act(() => askText("Primero", "a", () => askText("Segundo", "b", second)));
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Segundo" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("textbox")).toHaveValue("b");
    await user.keyboard("{Enter}");
    expect(second).toHaveBeenCalledWith("b");
  });

  it("el foco no se sale y las teclas del show no se disparan", async () => {
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    act(() => askChoice({ title: "Elige", options: [{ label: "Uno", onSelect: () => {} }] }));
    const user = userEvent.setup();
    const [cancel, one] = within(dialog()).getAllByRole("button");
    await user.tab();
    expect(one).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard("{PageDown}");
    expect(onKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onKey);
  });

  it("crear un grupo con el diálogo de verdad", async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Groups" }));
    await user.click(screen.getByRole("button", { name: /Nuevo grupo/ }));
    await user.keyboard("Cabezas{Enter}");
    expect(screen.getAllByText("Cabezas").length).toBeGreaterThan(0);
  });
});
