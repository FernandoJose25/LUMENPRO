import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { ChasesView } from "@/components/chases/ChasesView";

function Debug() {
  const { chases, scenes, liveValues, selectedInstance } = useFixtureStore();
  return (
    <pre data-testid="debug">
      {JSON.stringify({ chases, scenes, liveValues, selectedInstanceId: selectedInstance?.id })}
    </pre>
  );
}

function setup() {
  localStorage.clear();
  return render(
    <FixtureStoreProvider>
      <FixtureControl />
      <ScenesPanel />
      <ChasesView />
      <Debug />
    </FixtureStoreProvider>,
  );
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

/** FixtureControl es el único componente montado aquí que usa Fader
 *  (ChasesView no tiene sliders), así que el primer slider siempre es
 *  el del canal seleccionado en FixtureControl. */
function firstFaderNumberInput() {
  const slider = screen.getAllByRole("slider")[0];
  return within(slider.parentElement!).getByRole("spinbutton");
}

async function saveSceneWithValue(user: ReturnType<typeof userEvent.setup>, value: number, name: string) {
  fireEvent.change(firstFaderNumberInput(), { target: { value: String(value) } });
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));
}

async function createChase(user: ReturnType<typeof userEvent.setup>, name: string) {
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Nuevo chase/i }));
}

async function addStep(user: ReturnType<typeof userEvent.setup>, sceneName: string) {
  const select = screen.getByRole("combobox");
  await user.selectOptions(select, sceneName);
  await user.click(screen.getByRole("button", { name: /\+ Agregar step/i }));
}

describe("ChasesView — edición de la secuencia", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("crea un chase y agrega dos steps referenciando escenas guardadas, con tiempos por defecto", async () => {
    const user = userEvent.setup();
    setup();

    await saveSceneWithValue(user, 200, "Escena A");
    await saveSceneWithValue(user, 250, "Escena B");
    await createChase(user, "Chase Test");
    await addStep(user, "Escena A");
    await addStep(user, "Escena B");

    const chase = readDebug().chases[0];
    expect(chase.steps).toHaveLength(2);
    expect(chase.steps[0].fadeMs).toBe(1000);
    expect(chase.steps[0].holdMs).toBe(3000);
  });

  it("mover un step invierte su posición en la secuencia", async () => {
    const user = userEvent.setup();
    setup();

    await saveSceneWithValue(user, 200, "Escena A");
    await saveSceneWithValue(user, 250, "Escena B");
    await createChase(user, "Chase Test");
    await addStep(user, "Escena A");
    await addStep(user, "Escena B");

    const scenesByName = Object.fromEntries(readDebug().scenes.map((s: { id: string; name: string }) => [s.name, s.id]));
    await user.click(screen.getAllByTitle("Mover abajo")[0]);

    const chase = readDebug().chases[0];
    expect(chase.steps[0].sceneId).toBe(scenesByName["Escena B"]);
    expect(chase.steps[1].sceneId).toBe(scenesByName["Escena A"]);
  });

  it("quitar un step lo elimina de la secuencia", async () => {
    const user = userEvent.setup();
    setup();

    await saveSceneWithValue(user, 200, "Escena A");
    await createChase(user, "Chase Test");
    await addStep(user, "Escena A");
    expect(readDebug().chases[0].steps).toHaveLength(1);

    await user.click(screen.getByTitle("Quitar step"));
    expect(readDebug().chases[0].steps).toHaveLength(0);
  });

  it("el toggle de Loop persiste en el chase", async () => {
    const user = userEvent.setup();
    setup();
    await createChase(user, "Chase Test");

    expect(readDebug().chases[0].loop).toBe(true); // default

    await user.click(screen.getByRole("checkbox", { name: /loop/i }));
    expect(readDebug().chases[0].loop).toBe(false);
  });
});

describe("ChasesView — reproducción real (timers controlados)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproducir interpola liveValues desde el valor actual hacia el de cada step, y detener congela el valor", async () => {
    const user = userEvent.setup();
    setup();

    // Escena A = 200, Escena B = 250, ambas sobre el mismo canal del
    // fixture seleccionado por defecto.
    await saveSceneWithValue(user, 200, "Escena A");
    await saveSceneWithValue(user, 250, "Escena B");
    // Bajar el valor en vivo a 0 antes de reproducir, para que el chase
    // tenga que subir de verdad hasta el objetivo de cada step.
    fireEvent.change(firstFaderNumberInput(), { target: { value: "0" } });

    await createChase(user, "Chase Test");
    await addStep(user, "Escena A"); // fade 1000ms, hold 3000ms (defaults)
    await addStep(user, "Escena B");

    const stateBefore = readDebug();
    const instanceId = stateBefore.selectedInstanceId as string;
    const channelId = Object.keys(stateBefore.scenes[0].values[instanceId])[0];
    const readChannel = () => readDebug().liveValues[instanceId][channelId];

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /▶ Reproducir/i }));

    // A mitad del fade del step 1 (fade=1000ms) el valor debe estar
    // interpolando entre 0 y 200, ni pegado al origen ni al destino.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const mid = readChannel();
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(180);

    // Terminado el fade del step 1 (t=1000ms totales), debe llegar
    // exactamente al valor objetivo de Escena A.
    act(() => {
      vi.advanceTimersByTime(600); // total ~1100ms desde play()
    });
    expect(readChannel()).toBe(200);

    // Pasado el hold del step 1 (3000ms) más un poco del fade del step 2
    // (otros 1000ms), debe estar en tránsito hacia 250 (Escena B).
    act(() => {
      vi.advanceTimersByTime(3400); // total ~4500ms: dentro del fade del step 2
    });
    const midStep2 = readChannel();
    expect(midStep2).toBeGreaterThan(200);
    expect(midStep2).toBeLessThan(250);

    // Terminado el fade del step 2, debe llegar exactamente a 250.
    act(() => {
      vi.advanceTimersByTime(600); // total ~5100ms
    });
    expect(readChannel()).toBe(250);

    // Detener debe congelar el valor: avanzar más tiempo no debe seguir
    // moviendo el canal (el chase con loop=true seguiría animando si no
    // se hubiera detenido).
    fireEvent.click(screen.getByRole("button", { name: /■ Detener/i }));
    const frozen = readChannel();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(readChannel()).toBe(frozen);
  });
});
