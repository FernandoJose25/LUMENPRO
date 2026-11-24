import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));

const ADDRESSES = [
  { url: "http://192.168.1.20:8777", qrSize: 25, qrPath: "M0,0h1v1h-1z" },
  { url: "http://192.168.137.1:8777", qrSize: 25, qrPath: "M1,0h1v1h-1z" },
];

/** Servidor falso: mismas respuestas que src-tauri/src/remote.rs. */
function fakeServer() {
  const status = { running: false, pin: "123456", error: null as string | null, addresses: ADDRESSES };
  let channel: { onmessage: (message: unknown) => void } | null = null;
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "engine_status") return { state: "running", output: "Mock", lastError: null, fps: 30 };
    if (cmd === "list_serial_ports") return [];
    if (cmd === "remote_attach") channel = a.onCommand as typeof channel;
    if (cmd === "remote_set_enabled") status.running = a.enabled as boolean;
    if (cmd === "remote_new_pin") status.pin = "654321";
    if (cmd.startsWith("remote_") && cmd !== "remote_publish") return { ...status };
  });
  return {
    status,
    phone: (command: unknown) => act(async () => channel!.onmessage(command)),
  };
}

function published() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "remote_publish")
    .map(([, args]) => JSON.parse((args as { snapshot: string }).snapshot));
}
const lastPublished = () => published()[published().length - 1];

async function openWithTemplate() {
  const server = fakeServer();
  render(<App />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("remote_attach", expect.anything()));
  fireEvent.click(screen.getByRole("button", { name: "Momentos" }));
  fireEvent.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
  const id = (name: string): string =>
    lastPublished().moments.find((m: { name: string }) => m.name === name).id;
  return { ...server, id };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Órdenes del celular", () => {
  it("Siguiente avanza, y el celular recibe el momento activo", async () => {
    const { phone, id } = await openWithTemplate();
    await phone({ type: "next", from: null });
    expect(lastPublished().activeId).toBe(id("Recepción"));
    expect(lastPublished().startedAt).toEqual(expect.any(Number));
    await phone({ type: "next", from: id("Recepción") });
    expect(lastPublished().activeId).toBe(id("Entrada"));
    await phone({ type: "prev", from: id("Entrada") });
    expect(lastPublished().activeId).toBe(id("Recepción"));
  });

  it("un doble toque, o dos celulares a la vez, no se saltan un momento", async () => {
    const { phone, id } = await openWithTemplate();
    await phone({ type: "moment", id: id("Vals") });
    await phone({ type: "next", from: id("Vals") });
    await phone({ type: "next", from: id("Vals") });
    expect(lastPublished().activeId).toBe(id("Fotos"));
  });

  it("blackout, estrobo, intensidad y detener", async () => {
    const { phone, id } = await openWithTemplate();
    await phone({ type: "moment", id: id("Vals") });
    await phone({ type: "blackout", on: true });
    await phone({ type: "strobe", on: true });
    await phone({ type: "master", value: 40 });
    expect(lastPublished()).toMatchObject({ blackout: true, strobe: true, master: 40 });
    await phone({ type: "blackout", on: false });
    await phone({ type: "stop" });
    expect(lastPublished()).toMatchObject({ blackout: false, startedAt: null, activeId: id("Vals") });
  });

  it("cambiar de momento apaga el estrobo pero respeta la intensidad", async () => {
    const { phone, id } = await openWithTemplate();
    await phone({ type: "strobe", on: true });
    await phone({ type: "master", value: 60 });
    await phone({ type: "moment", id: id("Fotos") });
    expect(lastPublished()).toMatchObject({ strobe: false, master: 60 });
  });

  it("la intensidad queda siempre entre 0 y 100", async () => {
    const { phone } = await openWithTemplate();
    await phone({ type: "master", value: 900 });
    expect(lastPublished().master).toBe(100);
    await phone({ type: "master", value: -5 });
    expect(lastPublished().master).toBe(0);
  });

  it("ignora basura sin romperse", async () => {
    const { phone } = await openWithTemplate();
    const before = lastPublished();
    const garbage = [
      null,
      "next",
      42,
      [],
      {},
      { type: "borrar" },
      { type: "moment" },
      { type: "moment", id: "no-existe" },
      { type: "master", value: "50" },
      { type: "master", value: null },
      { type: "blackout" },
      { type: "strobe", on: "si" },
      { type: "next" },
    ];
    for (const command of garbage) await phone(command);
    expect(lastPublished()).toEqual(before);
  });
});

describe("Lo que se le publica al celular", () => {
  it("no manda nada por mover un fader: solo cambia cuando cambia lo que muestra", async () => {
    await openWithTemplate();
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    const before = published().length;
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Aumentar Pan" }));
    expect(published()).toHaveLength(before);
  });

  it("lleva los momentos en orden, el estado del cable y nada más del show", async () => {
    await openWithTemplate();
    await waitFor(() => expect(lastPublished().dmx).toBe("running"));
    expect(Object.keys(lastPublished()).sort()).toEqual(
      ["activeId", "blackout", "dmx", "master", "moments", "startedAt", "strobe"],
    );
    expect(lastPublished().moments[0]).toEqual({ id: expect.any(String), name: "Recepción", durationSec: null });
  });
});

describe("Pantalla Celular", () => {
  it("se enciende, muestra QR, dirección y PIN, cambia el PIN y se apaga", async () => {
    const user = userEvent.setup();
    fakeServer();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Celular" }));
    await user.click(await screen.findByRole("button", { name: "Encender" }));

    expect(await screen.findByRole("img", { name: "QR de http://192.168.1.20:8777" })).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "http://192.168.137.1:8777");
    expect(screen.getByRole("img", { name: "QR de http://192.168.137.1:8777" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cambiar PIN" }));
    expect(await screen.findByText("654321")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apagar" }));
    expect(await screen.findByRole("button", { name: "Encender" })).toBeInTheDocument();
  });

  it("sin red lo dice, y si el puerto está ocupado muestra el error", async () => {
    const user = userEvent.setup();
    const { status } = fakeServer();
    status.running = true;
    status.addresses = [];
    status.error = "No se pudo abrir el puerto 8777";
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

describe("Intensidad y estrobo en Live", () => {
  it("se manejan también desde la laptop", async () => {
    const user = userEvent.setup();
    fakeServer();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Live" }));
    await user.click(screen.getByRole("button", { name: "Estrobo" }));
    await user.click(screen.getByRole("button", { name: "Disminuir Intensidad" }));
    expect(lastPublished().strobe).toBe(true);
    expect(lastPublished().master).toBeLessThan(100);
  });
});
