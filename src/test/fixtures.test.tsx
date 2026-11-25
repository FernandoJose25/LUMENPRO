import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { nextFreeAddress } from "@/lib/dmxFrame";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { seedDefinitions, seedInstances } from "@/data/fixtureLibrary";
import { STORAGE_KEY } from "@/lib/showFile";
import { ColorSwatches } from "@/components/fixtures/ColorSwatches";
import { willAnswer } from "./dialogs";
import { buildFrame } from "./frame";

type Store = ReturnType<typeof useFixtureStore>;
let store: Store;
function Probe() {
  store = useFixtureStore();
  return null;
}

const go = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const monitor = (channel: number) => screen.getAllByTitle(`Canal ${channel}`)[0].textContent;

function advance(ms: number) {
  for (let left = ms; left > 0; left -= 40) act(() => vi.advanceTimersByTime(Math.min(40, left)));
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Colores de un toque", () => {
  function mount(index: number[]) {
    function Swatches() {
      const { instances } = useFixtureStore();
      return <ColorSwatches instances={index.map((i) => instances[i])} />;
    }
    render(
      <FixtureStoreProvider>
        <Probe />
        <Swatches />
      </FixtureStoreProvider>,
    );
  }
  const par = () => buildFrame(store).slice(32, 39);

  it("pinta el PAR y lo saca de los programas automáticos", () => {
    mount([2]);
    const mode = store.definitions[1].channels.find((c) => c.type === "MODE")!.id;
    act(() => store.setChannelValue(store.instances[2].id, mode, 220));
    go("Ámbar");
    expect(par()).toEqual([255, 255, 110, 20, 0, 0, 0]);
  });

  it("si el dimmer estaba en 0 lo sube; si estaba a medias lo respeta", () => {
    mount([2, 3]);
    const dimmer = store.definitions[1].channels.find((c) => c.type === "DIMMER")!.id;
    act(() => store.setChannelValue(store.instances[2].id, dimmer, 0));
    act(() => store.setChannelValue(store.instances[3].id, dimmer, 90));
    go("Rojo");
    expect(buildFrame(store)[32]).toBe(255);
    expect(buildFrame(store)[39]).toBe(90);
  });

  it("en una cabeza sin RGB no aparece", () => {
    mount([0]);
    expect(screen.queryByRole("button", { name: "Rojo" })).not.toBeInTheDocument();
  });
});

describe("Presets de canal", () => {
  it("los botones de FIXTURE CONTROL escriben el centro del rango", () => {
    render(<App />);
    go("Cerrado");
    go("DMX Output");
    expect(monitor(7)).toBe("004");
    go("Dashboard");
    go("Abierto");
    go("DMX Output");
    expect(monitor(7)).toBe("252");
  });
});

describe("Identificar una luz", () => {
  it("la enciende a pleno 3 segundos y vuelve a como estaba", () => {
    render(<App />);
    go("DMX Output");
    const before = [monitor(6), monitor(33), monitor(34)];
    go("Identificar LPC007 PAR #1");
    advance(120);
    expect([monitor(33), monitor(34), monitor(35), monitor(36)]).toEqual(["255", "255", "255", "255"]);
    expect(monitor(41)).toBe("000"); // el PAR #2 no
    advance(3100);
    expect([monitor(6), monitor(33), monitor(34)]).toEqual(before);
  });

  it("no se salta el Blackout", () => {
    const frame = buildFrame({
      instances: seedInstances,
      definitions: seedDefinitions,
      liveValues: {},
      blackoutActive: true,
      master: 100,
      strobeActive: false,
      identifyId: seedInstances[2].id,
    });
    expect(frame.slice(32, 36)).toEqual([0, 0, 0, 0]);
  });
});

describe("Invertir pan y tilt por montaje", () => {
  it("espeja solo esa unidad, y vuelve a la normal si el perfil ya invertía", () => {
    const base = {
      definitions: seedDefinitions,
      liveValues: {},
      blackoutActive: false,
      master: 100,
      strobeActive: false,
      identifyId: null,
    };
    const instances = [{ ...seedInstances[0], panInvert: true, tiltInvert: true }, seedInstances[1]];
    const frame = buildFrame({ ...base, instances });
    expect([frame[0], frame[2]]).toEqual([127, 165]); // 255-128, 255-90
    expect([frame[16], frame[18]]).toEqual([128, 90]);

    const definitions = seedDefinitions.map((d) => ({
      ...d,
      channels: d.channels.map((c) => (c.type === "PAN" ? { ...c, invert: true } : c)),
    }));
    expect(buildFrame({ ...base, instances, definitions })[0]).toBe(128);
  });
});

describe("Direcciones libres", () => {
  it("busca el primer lugar donde entra entero", () => {
    expect(nextFreeAddress(seedInstances, seedDefinitions, 16)).toBe(61);
    expect(nextFreeAddress([], seedDefinitions, 16)).toBe(1);
    const gap = seedInstances.filter((i) => i.address !== 17); // libera 17–32
    expect(nextFreeAddress(gap, seedDefinitions, 16)).toBe(17);
    expect(nextFreeAddress(gap, seedDefinitions, 17)).toBe(61);
    expect(nextFreeAddress(seedInstances, seedDefinitions, 500)).toBe(1);
  });

  it("una unidad nueva no cae encima de otra", () => {
    render(<App />);
    go("Fixtures");
    go("+ Agregar unidad");
    go("DMX Output");
    expect(screen.queryByText(/Se pisa con/)).not.toBeInTheDocument();
    expect(screen.getByText("61–76")).toBeInTheDocument();
  });
});

describe("Equipo sin manual", () => {
  function addBar(channels = "10") {
    render(<App />);
    go("Fixtures");
    willAnswer("Barra LED", channels);
    go("+ Equipo sin manual");
  }

  it("crea los canales en direcciones libres y abre el identificador", () => {
    addBar();
    expect(screen.getByText("IDENTIFICAR CANALES — BARRA LED #1")).toBeInTheDocument();
    expect(screen.getByText("1 · DMX 61")).toBeInTheDocument();
    expect(screen.getByText("10 · DMX 70")).toBeInTheDocument();
  });

  it("con una cantidad imposible no crea nada", () => {
    for (const bad of ["0", "abc", "600", "2.5", ""]) {
      addBar(bad);
      expect(screen.queryByText(/IDENTIFICAR CANALES/)).not.toBeInTheDocument();
      expect(screen.queryByText("BARRA LED")).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("Barrer sube y baja el canal, y al parar vuelve a su valor", () => {
    addBar();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "30" } });
    go("Barrer canal 1");
    advance(1000);
    const value = () => Number((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value);
    expect(value()).toBeGreaterThan(90);
    expect(value()).toBeLessThan(160);
    advance(1000);
    expect(value()).toBeGreaterThan(240);
    go("Barrer canal 1");
    expect(value()).toBe(30);
    advance(1000);
    expect(value()).toBe(30);
  });

  it("barrer otro canal suelta el anterior donde estaba", () => {
    addBar();
    go("Barrer canal 1");
    advance(1000);
    go("Barrer canal 2");
    advance(1000);
    const value = (i: number) => Number((screen.getAllByRole("spinbutton")[i] as HTMLInputElement).value);
    expect(value(0)).toBe(0);
    expect(value(1)).toBeGreaterThan(90);
  });

  it("elegir la función renombra el canal, pero respeta un nombre puesto a mano", () => {
    addBar();
    fireEvent.change(screen.getByLabelText("Función del canal 1"), { target: { value: "DIMMER" } });
    fireEvent.change(screen.getByLabelText("Función del canal 2"), { target: { value: "TILT" } });
    go("Listo");
    act(() => vi.advanceTimersByTime(1100));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const bar = saved.definitions.find((d: { model: string }) => d.model === "Barra LED");
    expect(bar.channels.slice(0, 3).map((c: { name: string }) => c.name)).toEqual(["Dimmer", "Tilt", "Canal 3"]);
  });

  it("guarda el valor inicial y los presets, y quedan como botones", () => {
    addBar();
    fireEvent.change(screen.getAllByRole("spinbutton")[2], { target: { value: "200" } });
    go("Usar como valor inicial del canal 3");
    expect(screen.getByRole("button", { name: "Usar como valor inicial del canal 3" })).toHaveTextContent("Inicial: 200");
    willAnswer("Abierto barra");
    go("Guardar preset del canal 3");
    expect(screen.getByText("Abierto barra")).toBeInTheDocument();
    go("Listo");
    go(/BARRA LED/);
    go("BARRA LED #1");
    expect(screen.getByRole("button", { name: "Abierto barra" })).toBeInTheDocument();
  });

  it("un preset se puede borrar y, en la rueda de color, darle color", () => {
    addBar();
    fireEvent.change(screen.getByLabelText("Función del canal 1"), { target: { value: "COLOR_WHEEL" } });
    willAnswer("Azul");
    go("Guardar preset del canal 1");
    fireEvent.change(screen.getByLabelText("Color de Azul"), { target: { value: "#0000ff" } });
    expect(screen.getByLabelText("Color de Azul")).toHaveValue("#0000ff");
    go("Borrar preset Azul");
    expect(screen.queryByLabelText("Color de Azul")).not.toBeInTheDocument();
  });
});

describe("Escenario", () => {
  it("mover una luz queda guardado en el show y se puede deshacer", () => {
    render(<App />);
    go("Escenario");
    go("BEAM 280 ORUS #1");
    expect(screen.getByLabelText("Altura")).toHaveValue("1");
    fireEvent.change(screen.getByLabelText("Altura"), { target: { value: "3.5" } });
    fireEvent.click(screen.getByLabelText("Colgada de un truss"));
    act(() => vi.advanceTimersByTime(1100));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.instances[0].placement).toMatchObject({ y: 3.5, hung: true });
    go("Volver a la posición inicial");
    expect(screen.getByLabelText("Altura")).toHaveValue("1");
  });

  it("un PAR tiene inclinación y no opciones de cabeza", () => {
    render(<App />);
    go("Escenario");
    go("LPC007 PAR #1");
    expect(screen.getByLabelText("Inclinación")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invertir pan")).not.toBeInTheDocument();
  });

  it("invertir pan cambia lo que sale por el cable", () => {
    render(<App />);
    go("Escenario");
    go("BEAM 280 ORUS #1");
    fireEvent.click(screen.getByLabelText("Invertir pan"));
    go("DMX Output");
    expect(monitor(1)).toBe("127");
  });

  it("se pueden probar los momentos desde ahí", () => {
    render(<App />);
    go("Momentos");
    go("Usar plantilla de quinceañera");
    go("Escenario");
    go("Fotos");
    advance(1500);
    go("DMX Output");
    expect(monitor(33)).toBe("255");
    expect(within(screen.getByText("BEAM 280 ORUS #1").closest("div")!.parentElement!).getByTitle("Canal 6")).toHaveTextContent("255");
  });
});
