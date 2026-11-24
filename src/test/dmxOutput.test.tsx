import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { STORAGE_KEY } from "@/lib/showFile";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

type Args = Record<string, unknown>;
const STOPPED = { state: "stopped", output: "", lastError: null, fps: 0 };

/** Motor de Rust falso: responde lo mismo que los comandos de main.rs. */
function fakeEngine(overrides: Record<string, (args: Args) => unknown> = {}) {
  let status: unknown = STOPPED;
  const handlers: Record<string, (args: Args) => unknown> = {
    list_serial_ports: () => [
      { name: "COM1", chip: "other", description: "" },
      { name: "COM5", chip: "ftdi", description: "USB Serial Port (COM5)" },
    ],
    engine_status: () => status,
    connect_open_dmx: ({ port }) => {
      status = { state: "running", output: `Cable FTDI (${port})`, lastError: null, fps: 30 };
    },
    connect_mock: () => {
      status = { state: "running", output: "Mock (sin hardware)", lastError: null, fps: 30 };
    },
    disconnect: () => {
      status = STOPPED;
    },
    ...overrides,
  };
  vi.mocked(invoke).mockImplementation(async (cmd, args) => handlers[cmd]?.((args ?? {}) as Args));
  return { setStatus: (s: unknown) => (status = s) };
}

function sentFrames() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([cmd]) => cmd === "set_block")
    .map(([, args]) => args as { startChannel: number; values: number[] });
}

function lastFrame() {
  const frames = sentFrames();
  return frames[frames.length - 1].values;
}

async function openSection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Salida DMX desde la interfaz", () => {
  it("propone el puerto FTDI, conecta y la barra superior pasa a Conectado", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await openSection(user, "DMX Output");

    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(invoke).toHaveBeenCalledWith("connect_open_dmx", { port: "COM5", fps: 30 });
    expect(await screen.findByText("Cable FTDI (COM5)")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
  });

  it("manda los 512 canales y los vuelve a mandar cuando cambia algo", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await waitFor(() => expect(sentFrames().length).toBeGreaterThan(0));
    expect(sentFrames()[0].startChannel).toBe(1);
    expect(sentFrames()[0].values).toHaveLength(512);
    expect(sentFrames()[0].values[32]).toBe(255); // Master Dimmer del PAR #1

    const pan = screen.getAllByRole("spinbutton")[0];
    await user.clear(pan);
    await user.type(pan, "77");
    await waitFor(() => expect(lastFrame()[0]).toBe(77));
  });

  it("Blackout apaga la salida sin mover Pan, y volver a encender la restaura", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await waitFor(() => expect(sentFrames().length).toBeGreaterThan(0));
    const before = lastFrame();

    await user.click(screen.getByRole("button", { name: "BLACKOUT" }));
    await user.click(screen.getByRole("button", { name: "CONFIRMAR" }));
    await waitFor(() => expect(lastFrame()[32]).toBe(0));
    expect(lastFrame()[0]).toBe(before[0]);

    await user.click(screen.getByRole("button", { name: "VOLVER A ENCENDER" }));
    await waitFor(() => expect(lastFrame()).toEqual(before));
  });

  it("con el IPC lento no acumula envíos: salta los intermedios y termina en el último valor", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    fakeEngine({ set_block: () => gate });
    render(<App />);
    await waitFor(() => expect(sentFrames()).toHaveLength(1));

    const user = userEvent.setup();
    const plus = screen.getByRole("button", { name: "Aumentar Pan" });
    for (let i = 0; i < 5; i++) await user.click(plus);
    expect(sentFrames()).toHaveLength(1);

    await act(async () => release());
    await waitFor(() => expect(sentFrames()).toHaveLength(2));
    expect(sentFrames()[1].values[0]).toBe(sentFrames()[0].values[0] + 5);
  });

  it("puerto ocupado: muestra el error y sigue desconectado", async () => {
    const user = userEvent.setup();
    fakeEngine({
      connect_open_dmx: () => {
        throw "error de puerto serie: Acceso denegado.";
      },
    });
    render(<App />);
    await openSection(user, "DMX Output");
    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Acceso denegado");
    expect(screen.getByText("Desconectado")).toBeInTheDocument();
  });

  it("si se suelta el cable, avisa que está reconectando", async () => {
    const engine = fakeEngine();
    render(<App />);
    engine.setStatus({ state: "reconnecting", output: "Cable FTDI (COM5)", lastError: "cable", fps: 0 });
    expect(await screen.findByText("Reconectando…", {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it("al reabrir la app reconecta sola al último adaptador, salvo que se haya desconectado a mano", async () => {
    const user = userEvent.setup();
    fakeEngine();
    const first = render(<App />);
    await openSection(user, "DMX Output");
    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await screen.findByText("Cable FTDI (COM5)");
    first.unmount();

    vi.mocked(invoke).mockClear();
    fakeEngine();
    const second = render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("connect_open_dmx", { port: "COM5", fps: 30 }));
    await openSection(user, "DMX Output");
    await user.click(await screen.findByRole("button", { name: "Desconectar" }));
    await screen.findByRole("button", { name: "Conectar" });
    second.unmount();

    vi.mocked(invoke).mockClear();
    fakeEngine();
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("engine_status"));
    expect(invoke).not.toHaveBeenCalledWith("connect_open_dmx", expect.anything());
  });

  it("avisa si el adaptador es CH340", async () => {
    const user = userEvent.setup();
    fakeEngine({ list_serial_ports: () => [{ name: "COM3", chip: "ch340", description: "" }] });
    render(<App />);
    await openSection(user, "DMX Output");
    expect(await screen.findByText(/chip CH340/)).toBeInTheDocument();
  });

  it("en el navegador no llama a Rust y lo explica", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    await openSection(user, "DMX Output");
    expect(screen.getByText(/En el navegador no hay salida DMX/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("Guardar, exportar e importar el show", () => {
  it("Save guarda en disco al momento y lo confirma", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "Guardado" })).toBeInTheDocument();
    const [, args] = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "save_show")!;
    const saved = JSON.parse((args as { json: string }).json);
    expect(saved.instances).toHaveLength(6);
    expect(saved).not.toHaveProperty("blackoutActive");
    expect(saved).not.toHaveProperty("runningEffectIds");
  });

  it("si el disco falla, Save no dice que guardó", async () => {
    const user = userEvent.setup();
    fakeEngine({
      save_show: () => {
        throw "disco lleno";
      },
    });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Error al guardar" })).toBeInTheDocument();
  });

  it("los cambios se guardan solos, también los que quedaron pendientes al cerrar", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    const pan = screen.getAllByRole("spinbutton")[0];
    await user.clear(pan);
    await user.type(pan, "99");
    unmount();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(Object.values(saved.liveValues[saved.instances[0].id])).toContain(99);
  });

  it("exportar muestra la ruta; importar reemplaza el show", async () => {
    const user = userEvent.setup();
    fakeEngine({ export_show: ({ fileName }) => `C:\\Documentos\\LUMEN PRO\\${fileName}` });
    render(<App />);
    await openSection(user, "Settings");
    await user.click(screen.getByRole("button", { name: "Exportar show" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/LUMEN PRO\\lumenpro-show-.*\.json/);

    const [, args] = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "export_show")!;
    const show = JSON.parse((args as { json: string }).json);
    show.scenes = [{ id: "s1", name: "Vals", values: {}, createdAt: 0, updatedAt: 0 }];

    vi.spyOn(window, "confirm").mockReturnValue(true);
    const file = new File([JSON.stringify(show)], "respaldo.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("Archivo de show"), file);
    expect(await screen.findByText("Show importado: respaldo.json")).toBeInTheDocument();

    await openSection(user, "Live");
    expect(screen.getByRole("button", { name: "Vals" })).toBeInTheDocument();
  });

  it("importar un archivo que no es un show lo rechaza y no toca el actual", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await openSection(user, "Settings");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.upload(
      screen.getByLabelText("Archivo de show"),
      new File(['{"otra":"cosa"}'], "foto.json", { type: "application/json" }),
    );
    expect(await screen.findByText("El archivo no es un show de LUMEN PRO")).toBeInTheDocument();
    await openSection(user, "DMX Output");
    expect(screen.getByText("BEAM 280 ORUS #1")).toBeInTheDocument();
  });
});

describe("Editar el perfil de un fixture existente", () => {
  it("guarda los cambios (antes se descartaban)", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    const user = userEvent.setup();
    render(<App />);
    await openSection(user, "Fixtures");
    await user.click(screen.getByRole("button", { name: "Editar perfil" }));
    const model = screen.getByLabelText(/Model/);
    await user.clear(model);
    await user.type(model, "Orus 26CH");
    await user.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect(screen.getByText("ORUS 26CH")).toBeInTheDocument();
  });
});
