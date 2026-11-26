import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import { PalettesView } from "@/components/palettes/PalettesView";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { readAxis, writeAxis } from "@/lib/panTilt";
import { aimAt, beamDirection, beamEnd } from "@/lib/stage";
import type { ChannelType, Placement } from "@/types/fixture";
import { willAnswer } from "./dialogs";
import { buildFrame } from "./frame";

type Store = ReturnType<typeof useFixtureStore>;
let store: Store;
function Probe() {
  store = useFixtureStore();
  return null;
}

const HEAD = 0; // Orus #1, DMX 1–16
const PAR = 2;

function channel(instance: number, type: ChannelType) {
  const i = store.instances[instance];
  const c = store.definitions.find((d) => d.id === i.definitionId)!.channels.find((ch) => ch.type === type)!;
  return { instanceId: i.id, channelId: c.id };
}
function set(instance: number, type: ChannelType, value: number) {
  const { instanceId, channelId } = channel(instance, type);
  act(() => store.setChannelValue(instanceId, channelId, value));
}
const live = (instance: number, type: ChannelType) => {
  const { instanceId, channelId } = channel(instance, type);
  return store.getChannelValue(instanceId, channelId, -1);
};
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 40) act(() => vi.advanceTimersByTime(Math.min(40, left)));
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  render(
    <FixtureStoreProvider>
      <Probe />
      <PalettesView />
    </FixtureStoreProvider>,
  );
});
afterEach(() => vi.useRealTimers());

const save = (column: string, name: string) => {
  willAnswer(name);
  fireEvent.click(screen.getByRole("button", { name: column }));
};

describe("Paletas", () => {
  it("si se corrige una posición, cambian todas las escenas que la usan", () => {
    set(HEAD, "PAN", 40);
    set(HEAD, "TILT", 30);
    save("+ Guardar la posición actual", "Pista");
    set(PAR, "RED", 200);
    act(() => void store.saveScene("Vals"));
    act(() => void store.saveScene("Fotos"));
    expect(store.scenes[0].refs?.[store.instances[HEAD].id]).toEqual({ position: store.palettes[0].id });

    // Se corrige: las cabezas apuntan a otro lado y se actualiza la paleta.
    set(HEAD, "PAN", 90);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar Pista" }));
    set(HEAD, "PAN", 0);
    for (const scene of store.scenes) {
      act(() => store.recallScene(scene.id));
      expect([live(HEAD, "PAN"), live(HEAD, "TILT"), live(PAR, "RED")]).toEqual([90, 30, 200]);
      set(HEAD, "PAN", 0);
    }
    expect(screen.getByRole("button", { name: /Pista\s*2 esc\./ })).toBeInTheDocument();
  });

  it("una escena guardada con otra posición no la sigue", () => {
    set(HEAD, "PAN", 40);
    save("+ Guardar la posición actual", "Pista");
    set(HEAD, "PAN", 41);
    act(() => void store.saveScene("Otra"));
    expect(store.scenes[0].refs?.[store.instances[HEAD].id]).toBeUndefined();
  });

  it("aplicar pone los valores solo en las luces elegidas", () => {
    set(HEAD, "PAN", 40);
    save("+ Guardar la posición actual", "Pista");
    set(HEAD, "PAN", 1);
    set(1, "PAN", 1);
    let group = "";
    act(() => void (group = store.addGroup("Solo la 1").id));
    act(() => store.setInstanceGroup(store.instances[HEAD].id, group));
    fireEvent.change(screen.getByLabelText("Luces"), { target: { value: group } });
    fireEvent.click(screen.getByRole("button", { name: /^Pista/ }));
    expect([live(HEAD, "PAN"), live(1, "PAN")]).toEqual([40, 1]);
  });

  it("un color sirve para los PAR, también para uno agregado después", () => {
    willAnswer("Rosa");
    fireEvent.change(screen.getByLabelText("Nuevo color"), { target: { value: "#ff3c8c" } });
    const par = store.instances[PAR];
    act(() => store.addInstance({ ...par, id: "nuevo", address: 200 }));
    act(() => store.applyPalette(store.palettes[0].id, store.instances));
    expect([live(PAR, "RED"), live(PAR, "GREEN"), live(PAR, "BLUE")]).toEqual([255, 60, 140]);
    expect(store.getChannelValue("nuevo", channel(PAR, "RED").channelId, -1)).toBe(255);
  });

  it("borrarla no cambia cómo se ven las escenas", () => {
    set(HEAD, "PAN", 40);
    save("+ Guardar la posición actual", "Pista");
    act(() => void store.saveScene("Vals"));
    set(HEAD, "PAN", 90);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar Pista" }));
    willAnswer(true);
    fireEvent.click(screen.getByRole("button", { name: "Borrar Pista" }));
    expect(store.palettes).toEqual([]);
    set(HEAD, "PAN", 0);
    act(() => store.recallScene(store.scenes[0].id));
    expect(live(HEAD, "PAN")).toBe(90);
  });

  it("deshacer recupera una paleta borrada", () => {
    save("+ Guardar la posición actual", "Pista");
    advance(1000);
    act(() => store.removePalette(store.palettes[0].id));
    act(() => store.undo());
    expect(store.palettes.map((p) => p.name)).toEqual(["Pista"]);
  });
});

describe("Figuras", () => {
  it("la plantilla mueve las cabezas con una figura sin tocar sus faders", () => {
    act(() => store.addQuinceTemplate());
    act(() => store.startMoment(store.moments.find((m) => m.name === "Hora loca")!.id));
    advance(2500);
    const pan = live(HEAD, "PAN");
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      advance(80);
      seen.add(buildFrame(store)[0]);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(live(HEAD, "PAN")).toBe(pan);
    expect(Object.keys(store.moving)).toHaveLength(2);
  });
});

describe("Apuntar a un punto del escenario", () => {
  const orus = () => store.definitions[0];

  it.each<[string, Placement]>([
    ["apoyada", { x: -3, y: 1, z: -3, yaw: 0, pitch: 0, hung: false }],
    ["colgada y girada", { x: 4, y: 5, z: -2, yaw: 70, pitch: 0, hung: true }],
  ])("%s: el haz cae en el punto", (_, placement) => {
    for (const target of [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 3 },
      { x: -5, y: 0, z: -1 },
    ]) {
      const to = aimAt(placement, orus(), target, { pan: 0.5, tilt: 0.5 })!;
      const values = { ...writeAxis(orus(), "PAN", to.pan), ...writeAxis(orus(), "TILT", to.tilt) };
      const read = (axis: "PAN" | "TILT") => readAxis(orus(), axis, (c) => values[c.id] ?? 0);
      const head = { pan: (read("PAN") - 0.5) * 540, tilt: (0.5 - read("TILT")) * 270 };
      const { end } = beamEnd(placement, beamDirection(placement, head));
      expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeLessThan(0.05);
    }
  });

  it("elige el camino más corto desde donde está", () => {
    const placement: Placement = { x: 0, y: 1, z: -3, yaw: 0, pitch: 0, hung: false };
    const target = { x: 0, y: 0, z: 0 };
    const near = aimAt(placement, orus(), target, { pan: 0.5, tilt: 0.5 })!;
    const far = aimAt(placement, orus(), target, { pan: 0.95, tilt: 0.5 })!;
    expect(Math.abs(near.pan - 0.5)).toBeLessThan(0.01);
    expect(far.pan).toBeGreaterThan(0.8);
  });
});

describe("En la app", () => {
  it("Escenario → Apuntar mueve las cabezas al tocar el piso", () => {
    vi.useRealTimers();
    const { unmount } = render(<App />);
    unmount();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Escenario" })[0]);
    expect(screen.getByRole("button", { name: "Apuntar" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Apuntar" }));
    expect(screen.getByRole("button", { name: "Apuntando todas las cabezas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("Effects: elegir una figura muestra su dibujo", () => {
    vi.useRealTimers();
    render(<App />);
    fireEvent.click(screen.getAllByRole("button", { name: "Effects" })[0]);
    willAnswer("Círculo");
    fireEvent.click(screen.getAllByRole("button", { name: /\+ Nuevo effect/ })[0]);
    fireEvent.change(screen.getAllByLabelText("Qué hace")[0], { target: { value: "figure" } });
    fireEvent.change(screen.getAllByLabelText("Figura")[0], { target: { value: "eight" } });
    expect(within(document.body).getAllByRole("img", { name: "Figura: Ocho" }).length).toBeGreaterThan(0);
  });
});
