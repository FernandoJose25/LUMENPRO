import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "@/App";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";

type Store = ReturnType<typeof useFixtureStore>;
let store: Store;

function Grab() {
  store = useFixtureStore();
  return null;
}

const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("Deshacer y rehacer lo programado", () => {
  beforeEach(() => {
    render(
      <FixtureStoreProvider>
        <Grab />
      </FixtureStoreProvider>,
    );
  });

  it("al abrir no hay nada que deshacer, y mover un fader o lanzar una escena no cuenta", () => {
    expect(store.canUndo).toBe(false);
    act(() => store.setChannelValue(store.instances[0].id, "ch-6", 200));
    act(() => store.blackout());
    expect(store.canUndo).toBe(false);
  });

  it("recupera una escena borrada y los momentos que la usaban, sin tocar las luces", () => {
    let sceneId = "";
    act(() => store.setChannelValue(store.instances[0].id, "ch-6", 200));
    act(() => void (sceneId = store.saveScene("Vals").id));
    act(() => void store.addMoment("Vals"));
    act(() => store.updateMoment(store.moments[0].id, { sceneId }));
    act(() => store.removeScene(sceneId));
    expect(store.moments[0].sceneId).toBeNull();
    act(() => store.setChannelValue(store.instances[0].id, "ch-6", 90));

    act(() => store.undo());
    expect(store.scenes.map((s) => s.name)).toEqual(["Vals"]);
    expect(store.moments[0].sceneId).toBe(sceneId);
    expect(store.getChannelValue(store.instances[0].id, "ch-6", -1)).toBe(90);

    act(() => store.redo());
    expect(store.scenes).toEqual([]);
    expect(store.canRedo).toBe(false);
  });

  it("arrastrar o escribir es un solo paso; agregar dos cosas seguidas son dos", () => {
    const original = store.instances[0];
    for (let address = 2; address <= 6; address++) {
      act(() => store.updateInstance({ ...original, address }));
      wait(100);
    }
    wait(2000);
    act(() => void store.addGroup("A"));
    act(() => void store.addGroup("B"));

    act(() => store.undo());
    expect(store.groups.map((g) => g.name)).toEqual(["A"]);
    act(() => store.undo());
    expect(store.groups).toEqual([]);
    expect(store.instances[0].address).toBe(6);
    act(() => store.undo());
    expect(store.instances[0].address).toBe(1);
    expect(store.canUndo).toBe(false);
  });

  it("un cambio nuevo descarta lo que se podía rehacer", () => {
    act(() => void store.addGroup("A"));
    act(() => store.undo());
    expect(store.canRedo).toBe(true);
    act(() => void store.addGroup("B"));
    expect(store.canRedo).toBe(false);
    expect(store.groups.map((g) => g.name)).toEqual(["B"]);
  });

  it("deshacer la plantilla deja de correr lo que ya no existe", () => {
    act(() => store.addQuinceTemplate());
    act(() => store.startMoment(store.moments[0].id));
    act(() => store.startEffect(store.effects[0].id));
    act(() => store.undo());
    expect(store.moments).toEqual([]);
    expect(store.momentRun).toBeNull();
    expect(store.activeMomentId).toBeNull();
    expect(store.runningEffectIds).toEqual([]);
  });

  it("importar un show se puede deshacer", () => {
    act(() => void store.addGroup("Mío"));
    act(() => store.importShow(JSON.stringify({ definitions: [], instances: [] })));
    expect(store.groups).toEqual([]);
    act(() => store.undo());
    expect(store.groups.map((g) => g.name)).toEqual(["Mío"]);
    expect(store.instances).toHaveLength(6);
  });
});

describe("Undo y Redo en la barra superior", () => {
  it("botones y atajos; en un campo de texto Ctrl+Z no toca el show", () => {
    render(<App />);
    const undo = screen.getByRole("button", { name: "Deshacer" });
    const redo = screen.getByRole("button", { name: "Rehacer" });
    expect(undo).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Momentos" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
    expect(undo).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Fixtures" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Search Fixture..."), { key: "z", ctrlKey: true });
    expect(undo).toBeEnabled();

    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(redo).toBeDisabled();
    fireEvent.click(undo);
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(redo).toBeDisabled();
  });

  it("no muestra datos inventados: sin música no hay BPM", () => {
    render(<App />);
    expect(screen.queryByText(/BPM/)).toBeNull();
    expect(screen.queryByText(/CPU/)).toBeNull();
  });
});
