import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { LiveMoments } from "@/components/live/LiveMoments";
import { buildFrame } from "./frame";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { STORAGE_KEY } from "@/lib/showFile";
import type { ChannelType } from "@/types/fixture";

type Store = ReturnType<typeof useFixtureStore>;
let store: Store;

function Engines() {
  store = useFixtureStore();
  return null;
}

// Los timers falsos van ANTES de montar: los motores registran su intervalo
// al montarse (misma nota que en effects.test.tsx).
function mount(ui: React.ReactNode = null) {
  return render(
    <FixtureStoreProvider>
      <Engines />
      {ui}
    </FixtureStoreProvider>,
  );
}

// Tick a tick: dentro de un mismo act() React no repinta, y los motores leen
// el estado del último render.
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 40) act(() => vi.advanceTimersByTime(Math.min(40, left)));
}
const frame = () => buildFrame(store);

const HEAD = 0; // Orus #1, DMX 1–16
const PAR = 2; // PAR #1, DMX 33–39

function channel(instance: number, type: ChannelType) {
  const i = store.instances[instance];
  const c = store.definitions.find((d) => d.id === i.definitionId)!.channels.find((ch) => ch.type === type)!;
  return { instanceId: i.id, channelId: c.id };
}

function set(instance: number, type: ChannelType, value: number) {
  const { instanceId, channelId } = channel(instance, type);
  act(() => store.setChannelValue(instanceId, channelId, value));
}

function live(instance: number, type: ChannelType) {
  const { instanceId, channelId } = channel(instance, type);
  return store.getChannelValue(instanceId, channelId, -1);
}

function saveScene(name: string) {
  let id = "";
  act(() => void (id = store.saveScene(name).id));
  return id;
}

function addMoment(name: string, patch: Parameters<Store["updateMoment"]>[1] = {}) {
  let id = "";
  act(() => void (id = store.addMoment(name).id));
  act(() => store.updateMoment(id, patch));
  return id;
}

function addParEffect(type: ChannelType) {
  let groupId = "";
  let id = "";
  act(() => void (groupId = store.addGroup("G").id));
  act(() => store.setInstanceGroup(store.instances[PAR].id, groupId));
  act(() => void (id = store.addEffect("Fx").id));
  act(() => store.updateEffect(id, { groupId, channelType: type, waveform: "square", min: 11, max: 222 }));
  return id;
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

describe("Lanzar un momento", () => {
  it("hace fade hacia su escena y llega exacto", () => {
    mount();
    set(PAR, "RED", 200);
    const sceneId = saveScene("Rojo");
    set(PAR, "RED", 0);
    const id = addMoment("Entrada", { sceneId, fadeMs: 1000 });

    act(() => store.startMoment(id));
    advance(500);
    expect(live(PAR, "RED")).toBeGreaterThan(60);
    expect(live(PAR, "RED")).toBeLessThan(140);
    advance(600);
    expect(live(PAR, "RED")).toBe(200);
  });

  it("limpia lo que dejó el momento anterior aunque la escena no lo mencione", () => {
    mount();
    set(PAR, "RED", 200);
    const fotos = saveScene("Fotos"); // guardada antes de que existiera el estrobo
    set(PAR, "STROBE", 180);
    const fiesta = saveScene("Fiesta");
    const a = addMoment("Fiesta", { sceneId: fiesta, fadeMs: 0 });
    const b = addMoment("Fotos", { sceneId: fotos, fadeMs: 0 });

    act(() => store.startMoment(a));
    advance(100);
    expect(live(PAR, "STROBE")).toBe(180);
    act(() => store.startMoment(b));
    advance(100);
    expect(live(PAR, "STROBE")).toBe(0);
    expect(live(PAR, "RED")).toBe(200);
  });

  it("estrobo y gobo saltan en vez de cruzar todos los rangos intermedios", () => {
    mount();
    set(HEAD, "STROBE", 0);
    set(HEAD, "GOBO", 100);
    set(HEAD, "DIMMER", 200);
    const sceneId = saveScene("Cerrado");
    set(HEAD, "STROBE", 255);
    set(HEAD, "GOBO", 0);
    set(HEAD, "DIMMER", 0);
    const id = addMoment("Cerrado", { sceneId, fadeMs: 1000 });

    act(() => store.startMoment(id));
    advance(300);
    expect(live(HEAD, "STROBE")).toBe(0);
    expect(live(HEAD, "GOBO")).toBe(100);
    expect(live(HEAD, "DIMMER")).toBeLessThan(100);
  });

  it("sin escena deja las luces como estaban", () => {
    mount();
    set(PAR, "RED", 77);
    const id = addMoment("Solo effects");
    act(() => store.startMoment(id));
    advance(3000);
    expect(live(PAR, "RED")).toBe(77);
  });

  it("quita el Blackout", () => {
    mount();
    const id = addMoment("Vals");
    act(() => store.blackout());
    act(() => store.startMoment(id));
    expect(store.blackoutActive).toBe(false);
  });
});

describe("Effects y chases dentro de un momento", () => {
  it("los effects arrancan al terminar el fade y se cortan en el siguiente momento", () => {
    mount();
    const fx = addParEffect("RED");
    set(PAR, "BLUE", 50);
    const sceneId = saveScene("Base");
    const a = addMoment("Hora loca", { sceneId, effectIds: [fx], fadeMs: 1000 });
    const b = addMoment("Cierre", { sceneId, fadeMs: 0 });

    act(() => store.startMoment(a));
    advance(500);
    expect(store.runningEffectIds).toEqual([]);
    advance(700);
    expect(store.runningEffectIds).toEqual([fx]);
    expect([11, 222]).toContain(live(PAR, "RED"));

    act(() => store.startMoment(b));
    advance(200);
    expect(store.runningEffectIds).toEqual([]);
    expect(live(PAR, "RED")).toBe(0);
  });

  it("el chase arranca tras el fade y el siguiente momento lo para", () => {
    mount();
    set(PAR, "GREEN", 250);
    const verde = saveScene("Verde");
    set(PAR, "GREEN", 10);
    const base = saveScene("Base");
    let chaseId = "";
    act(() => void (chaseId = store.addChase("C").id));
    act(() => store.addChaseStep(chaseId, verde));
    const a = addMoment("Con chase", { sceneId: base, chaseId, fadeMs: 500 });
    const b = addMoment("Sin chase", { sceneId: base, fadeMs: 0 });

    act(() => store.startMoment(a));
    advance(400);
    expect(live(PAR, "GREEN")).toBe(10);
    advance(1800);
    expect(live(PAR, "GREEN")).toBe(250);

    act(() => store.startMoment(b));
    advance(6000);
    expect(live(PAR, "GREEN")).toBe(10);
  });

  it("Detener corta effects, chase y avance, y deja las luces como están", () => {
    mount();
    const fx = addParEffect("RED");
    const a = addMoment("A", { effectIds: [fx], fadeMs: 0, durationSec: 2 });
    addMoment("B");
    act(() => store.startMoment(a));
    advance(500);
    const red = live(PAR, "RED");
    act(() => store.stopMoment());
    advance(10_000);
    expect(store.runningEffectIds).toEqual([]);
    expect(live(PAR, "RED")).toBe(red);
    expect(store.activeMomentId).toBe(a);
  });
});

describe("Orden del evento", () => {
  it("Siguiente empieza por el primero, avanza en orden y en el último no hace nada", () => {
    mount();
    const ids = ["A", "B"].map((n) => addMoment(n));
    for (const expected of [ids[0], ids[1], ids[1]]) {
      act(() => store.stepMoment(1));
      expect(store.activeMomentId).toBe(expected);
    }
    act(() => store.stepMoment(-1));
    expect(store.activeMomentId).toBe(ids[0]);
  });

  it("con duración pasa solo, de a uno, y el que no tiene duración se queda esperando", () => {
    mount();
    const [a, b, c] = [
      addMoment("A", { durationSec: 2 }),
      addMoment("B", { durationSec: 3 }),
      addMoment("C"),
    ];
    addMoment("D");
    act(() => store.startMoment(a));
    advance(1900);
    expect(store.activeMomentId).toBe(a);
    advance(300);
    expect(store.activeMomentId).toBe(b);
    advance(2500);
    expect(store.activeMomentId).toBe(b);
    advance(700);
    expect(store.activeMomentId).toBe(c);
    advance(10_000);
    expect(store.activeMomentId).toBe(c);
  });

  it("con la interfaz trabada, el avance automático no relanza el momento nuevo en cada tick", () => {
    mount();
    const a = addMoment("A", { durationSec: 2 });
    const b = addMoment("B");
    act(() => store.startMoment(a));
    const t0 = store.momentRun!.startedAt;
    act(() => vi.advanceTimersByTime(3000)); // un solo act: sin repintar entre ticks
    expect(store.activeMomentId).toBe(b);
    expect(store.momentRun!.startedAt - t0).toBeLessThan(2100);
  });

  it("AvPág y RePág (pasador de diapositivas) avanzan y retroceden", () => {
    mount(<LiveMoments />);
    const [a, b] = [addMoment("A"), addMoment("B")];
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown" });
    expect(store.activeMomentId).toBe(b);
    fireEvent.keyDown(window, { key: "PageUp" });
    expect(store.activeMomentId).toBe(a);
  });

  it("mantener AvPág apretado no se salta el evento entero", () => {
    mount(<LiveMoments />);
    const a = addMoment("A");
    addMoment("B");
    fireEvent.keyDown(window, { key: "PageDown" });
    fireEvent.keyDown(window, { key: "PageDown", repeat: true });
    expect(store.activeMomentId).toBe(a);
  });

  it("si la app se cierra a mitad del evento, al abrir retoma el orden pero no arranca nada sola", () => {
    const { unmount } = mount();
    const fx = addParEffect("RED");
    const a = addMoment("A", { effectIds: [fx], fadeMs: 0 });
    const b = addMoment("B");
    act(() => store.startMoment(a));
    advance(500);
    unmount();

    mount();
    expect(store.activeMomentId).toBe(a);
    expect(store.momentRun).toBeNull();
    expect(store.runningEffectIds).toEqual([]);
    act(() => store.stepMoment(1));
    expect(store.activeMomentId).toBe(b);
  });

  it("borrar una escena, un effect o un chase no deja momentos apuntando a nada", () => {
    mount();
    const fx = addParEffect("RED");
    const sceneId = saveScene("S");
    let chaseId = "";
    act(() => void (chaseId = store.addChase("C").id));
    addMoment("A", { sceneId, chaseId, effectIds: [fx] });
    act(() => {
      store.removeScene(sceneId);
      store.removeEffect(fx);
      store.removeChase(chaseId);
    });
    expect(store.moments[0]).toMatchObject({ sceneId: null, chaseId: null, effectIds: [] });
  });
});

describe("Plantilla de quinceañera", () => {
  const start = (name: string) => {
    act(() => store.startMoment(store.moments.find((m) => m.name === name)!.id));
    advance(4000);
  };

  beforeEach(() => {
    mount();
    act(() => store.addQuinceTemplate());
  });

  it("crea los momentos en orden y agrupa cabezas y PAR", () => {
    expect(store.moments.map((m) => m.name)).toEqual([
      "Recepción",
      "Entrada",
      "Vals",
      "Fotos",
      "Brindis",
      "Hora loca",
      "Hora loca + estrobo",
      "Hora loca con música",
      "Cierre",
    ]);
    expect(store.groups.map((g) => g.name)).toEqual(["Cabezas", "PAR"]);
    expect(store.instances.every((i) => i.group)).toBe(true);
  });

  it("Fotos: todo blanco y quieto, también viniendo de la hora loca con estrobo", () => {
    start("Hora loca + estrobo");
    expect(frame()[32 + 4]).toBe(200); // estrobo del PAR #1
    start("Fotos");
    const still = frame();
    for (const par of [32, 39, 46, 53]) expect(still.slice(par, par + 7)).toEqual([255, 255, 255, 255, 0, 0, 0]);
    for (const head of [0, 16]) {
      expect(still[head]).toBe(128); // Pan al centro
      expect(still[head + 5]).toBe(255); // Dimmer
      expect(still[head + 6]).toBe(255); // Shutter abierto
    }
    advance(5000);
    expect(frame()).toEqual(still);
  });

  it("Hora loca mueve las cabezas y cambia los colores", () => {
    start("Hora loca");
    const before = frame();
    advance(700);
    const after = frame();
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(33, 36)).not.toEqual(before.slice(33, 36));
  });

  it("no toca los grupos que el usuario ya armó", () => {
    cleanup();
    localStorage.clear();
    mount();
    let mine = "";
    act(() => void (mine = store.addGroup("Mis luces").id));
    act(() => store.setInstanceGroup(store.instances[PAR].id, mine));
    act(() => store.addQuinceTemplate());
    expect(store.instances[PAR].group).toBe(mine);
    expect(store.groups.map((g) => g.name)).toEqual(["Mis luces", "Cabezas"]);
  });
});

describe("En la app", () => {
  it("plantilla → Live → Siguiente, y el momento sigue corriendo al cambiar de sección", () => {
    render(<App />);
    const go = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
    go("Momentos");
    go("Usar plantilla de quinceañera");
    go("Live");
    const bar = screen.getByRole("region", { name: "Momentos" });
    fireEvent.click(within(bar).getByRole("button", { name: "Hora loca" }));
    expect(within(bar).getByRole("button", { name: "Siguiente: Hora loca + estrobo ▶" })).toBeInTheDocument();
    go("DMX Output");
    advance(2000);
    const monitor = () => screen.getAllByTitle(/^Canal /).map((s) => s.textContent).join(" ");
    const before = monitor();
    advance(700);
    expect(monitor()).not.toBe(before);
  });

  it("corregir el número de un canal mueve la función sin romper las escenas", () => {
    render(<App />);
    const go = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
    const channelValue = (n: number) => screen.getAllByTitle(`Canal ${n}`)[0].textContent;
    go("Momentos");
    go("Usar plantilla de quinceañera");
    go("Live");
    fireEvent.click(within(screen.getByRole("region", { name: "Momentos" })).getByRole("button", { name: "Fotos" }));
    advance(3000);
    go("DMX Output");
    expect([channelValue(6), channelValue(15)]).toEqual(["255", "128"]); // Dimmer, Zoom

    go("Fixtures");
    go("Editar perfil");
    fireEvent.change(screen.getByLabelText("Número de canal de Dimmer"), { target: { value: "15" } });
    expect(screen.getByRole("alert")).toHaveTextContent("El canal 15 está repetido");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Número de canal de Zoom"), { target: { value: "6" } });
    go("Guardar perfil");

    go("DMX Output");
    expect([channelValue(6), channelValue(15)]).toEqual(["128", "255"]);
  });

  it("el show guardado incluye los momentos", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Momentos" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
    unmount();
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.moments).toHaveLength(9);
    expect(saved).not.toHaveProperty("momentRun");
  });
});
