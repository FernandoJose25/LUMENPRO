import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { STORAGE_KEY } from "@/lib/showFile";
import { willAnswer } from "./dialogs";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

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
    const engine = fakeEngine();
    render(<App />);
    await openSection(user, "DMX Output");

    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    expect(engine.sent("addOutput").map((r) => r.output)).toEqual([
      { id: expect.any(String), adapter: "open_dmx", universe: 1, port: "COM5", fps: 30, host: "", target: 0 },
    ]);
    expect(await screen.findByText("Cable FTDI (COM5)")).toBeInTheDocument();
    expect(screen.getByText("Conectado")).toBeInTheDocument();
    expect(screen.getAllByText("Universo 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Pausa más larga: 35 ms")).toBeInTheDocument();
  });

  it("lo que se mueve en pantalla llega al motor", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.frame()[32]).toBe(255)); // Master Dimmer del PAR #1

    const pan = screen.getAllByRole("spinbutton")[0];
    await user.clear(pan);
    await user.type(pan, "77");
    await waitFor(() => expect(engine.frame()[0]).toBe(77));
  });

  it("Blackout apaga la salida sin mover Pan, y volver a encender la restaura", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    // Con la PC cargada (toda la suite a la vez) el motor de prueba tarda más.
    const slow = { timeout: 5000 };
    await waitFor(() => expect(engine.frame()[32]).toBe(255), slow);
    const before = engine.frame();

    await user.click(screen.getByRole("button", { name: "BLACKOUT" }));
    await user.click(screen.getByRole("button", { name: "CONFIRMAR" }));
    await waitFor(() => expect(engine.frame()[32]).toBe(0), slow);
    expect(engine.frame()[0]).toBe(before[0]);

    await user.click(await screen.findByRole("button", { name: "VOLVER A ENCENDER" }, slow));
    await waitFor(() => expect(engine.frame()).toEqual(before), slow);
  }, 30_000);

  it("con el motor lento no acumula envíos: junta los intermedios y termina en el último valor", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    const engine = fakeEngine({
      send: async (r) => {
        if (held) await gate;
        return engine.commands.send(r as never);
      },
    });
    render(<App />);
    await waitFor(() => expect(engine.frame()[0]).toBe(128));
    const before = engine.sent("send").length;

    held = true;
    const user = userEvent.setup();
    const plus = screen.getByRole("button", { name: "Aumentar Pan" });
    for (let i = 0; i < 5; i++) await user.click(plus);
    expect(engine.sent("send").length - before).toBe(1);

    await act(async () => release());
    await waitFor(() => expect(engine.frame()[0]).toBe(133));
    expect(engine.sent("send").length - before).toBe(2);
  });

  it("puerto ocupado: muestra el error y sigue desconectado", async () => {
    const user = userEvent.setup();
    fakeEngine({
      addOutput: () => {
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
    engine.commands.addOutput({ cmd: "addOutput", output: { id: "a", adapter: "open_dmx", universe: 1, port: "COM5" } });
    engine.state.outputs = engine.state.outputs.map((o) => ({ ...o, state: "reconnecting", lastError: "cable" }));
    expect(await screen.findByText("Reconectando…", {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it("al reabrir la app reconecta sola las salidas, salvo las que se quitaron a mano", async () => {
    const user = userEvent.setup();
    fakeEngine();
    const first = render(<App />);
    await openSection(user, "DMX Output");
    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await screen.findByText("Cable FTDI (COM5)");
    first.unmount();

    const again = fakeEngine();
    const second = render(<App />);
    await waitFor(() => expect(again.sent("setOutputs")).toHaveLength(1));
    expect(again.state.outputs[0].config).toMatchObject({ adapter: "open_dmx", port: "COM5", universe: 1 });
    await openSection(user, "DMX Output");
    await user.click(await screen.findByRole("button", { name: "Desconectar Cable FTDI (COM5)" }));
    await screen.findByRole("button", { name: "Conectar" });
    second.unmount();

    const last = fakeEngine();
    render(<App />);
    await waitFor(() => expect(last.sent("wait").length).toBeGreaterThan(1));
    expect(last.sent("setOutputs")).toEqual([]);
  });

  it("recupera el adaptador que se conectó con la versión anterior", async () => {
    localStorage.setItem("lumenpro.dmx.last", JSON.stringify({ adapter: "open_dmx", port: "COM7", fps: 25 }));
    const engine = fakeEngine();
    render(<App />);
    await waitFor(() => expect(engine.state.outputs).toHaveLength(1));
    expect(engine.state.outputs[0].config).toMatchObject({ adapter: "open_dmx", port: "COM7", fps: 25, universe: 1 });
  });

  it("varias salidas a la vez: cable en el universo 1 y Art-Net en el 2", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine({ discoverArtnet: () => [{ ip: "10.0.0.5", name: "Nodo escenario", universes: [4, 5] }] });
    render(<App />);
    await openSection(user, "DMX Output");
    await waitFor(() => expect(screen.getByLabelText(/Puerto/)).toHaveValue("COM5"));
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await user.click(await screen.findByRole("button", { name: "+ Agregar salida" }));
    await user.selectOptions(screen.getByLabelText("Adaptador"), "artnet");
    fireEvent.change(screen.getByLabelText("Universo del show"), { target: { value: "2" } });
    expect(screen.getByLabelText("Universo Art-Net")).toHaveValue(1); // Art-Net cuenta desde 0

    await user.click(screen.getByRole("button", { name: "Buscar nodos en la red" }));
    await user.click(await screen.findByRole("button", { name: "Nodo escenario · universo 5" }));
    expect(screen.getByLabelText("IP del nodo")).toHaveValue("10.0.0.5");
    await user.click(screen.getByRole("button", { name: "Conectar" }));

    await waitFor(() => expect(engine.state.outputs).toHaveLength(2));
    expect(engine.state.outputs[1].config).toMatchObject({ adapter: "artnet", universe: 2, host: "10.0.0.5", target: 5 });
    expect(await screen.findByText("Universos 1, 2")).toBeInTheDocument();
  });

  it("sACN sin IP sale por multicast al mismo número de universo", async () => {
    const user = userEvent.setup();
    const engine = fakeEngine();
    render(<App />);
    await openSection(user, "DMX Output");
    await user.selectOptions(screen.getByLabelText("Adaptador"), "sacn");
    fireEvent.change(screen.getByLabelText("Universo del show"), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await waitFor(() => expect(engine.state.outputs).toHaveLength(1));
    expect(engine.state.outputs[0].config).toMatchObject({ adapter: "sacn", universe: 3, host: "", target: 3 });
  });

  it("avisa si una luz está en un universo que no sale por ningún lado", async () => {
    const user = userEvent.setup();
    fakeEngine();
    render(<App />);
    await openSection(user, "Fixtures");
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "2" } });
    await openSection(user, "DMX Output");
    await user.selectOptions(screen.getByLabelText("Adaptador"), "mock");
    await user.click(screen.getByRole("button", { name: "Conectar" }));
    await user.click(await screen.findByRole("button", { name: "Universo 2" }));
    expect(screen.getByText(/Universo 2: no sale por ningún lado/)).toBeInTheDocument();
  });

  it("Universes muestra los 512 canales, de quién son y cuánto valen", async () => {
    const user = userEvent.setup();
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    await openSection(user, "Universes");
    expect(screen.getAllByTitle(/^Canal /)).toHaveLength(512);
    expect(screen.getByTitle("Canal 33 · LPC007 PAR #1 · Master Dimmer")).toHaveTextContent("255");
    expect(screen.getByText(/60 canales usados · 452 libres/)).toBeInTheDocument();
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

    willAnswer(true);
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
    willAnswer(true);
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
