import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { fakeEngine } from "./fakeEngine";

// Lo que hace cada orden del celular se prueba en Rust (show-engine/tests y
// src-tauri/src/engine): acá, solo lo que se ve en la laptop.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Pantalla Celular", () => {
  it("se enciende, muestra QR, dirección y PIN, cambia el PIN y se apaga", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Celular" }));
    await user.click(await screen.findByRole("button", { name: "Encender" }));

    expect(await screen.findByRole("img", { name: "QR de http://192.168.1.20:8777" })).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Dirección"), "http://192.168.137.1:8777");
    expect(screen.getByRole("img", { name: "QR de http://192.168.137.1:8777" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cambiar PIN" }));
    expect(await screen.findByText("654321")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apagar" }));
    expect(await screen.findByRole("button", { name: "Encender" })).toBeInTheDocument();
  });

  it("sin red lo dice, y si el puerto está ocupado muestra el error", async () => {
    const user = userEvent.setup();
    const { state } = fakeEngine();
    Object.assign(state.remote, { running: true, addresses: [], error: "No se pudo abrir el puerto 8777" });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Celular" }));
    expect(await screen.findByText(/no está conectada a ninguna red/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("puerto 8777");
  });

  it("en el navegador no llama a Rust", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Celular" }));
    expect(screen.getByText(/En el navegador no se puede/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Lo que el celular cambia se ve en la laptop", () => {
  it("momento, intensidad y estrobo", async () => {
    const engine = fakeEngine();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Momentos" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => expect(engine.applied.some((m) => m.type === "doc")).toBe(true));

    engine.show.send({ type: "stepMoment", direction: 1 }, Date.now());
    engine.show.send({ type: "master", value: 40 }, Date.now());
    engine.show.send({ type: "strobe", on: true }, Date.now());
    engine.changed();
    expect(await screen.findByRole("button", { name: "Siguiente: Entrada ▶" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estrobo" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Intensidad" })).toHaveAttribute("aria-valuenow", "40");
  });

  it("y se manejan también desde la laptop", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(screen.getByRole("button", { name: "Estrobo" }));
    await user.click(screen.getByRole("button", { name: "Disminuir Intensidad" }));
    await waitFor(() => expect(engine.show.changes(0)!.playback).toMatchObject({ strobeActive: true, master: 99 }));
  });
});
