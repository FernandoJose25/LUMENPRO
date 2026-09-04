import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { GroupsView } from "@/components/groups/GroupsView";
import { EffectsView } from "@/components/effects/EffectsView";
import { useEffectsEngine } from "@/lib/effectEngine";

function EffectsEngineMount() {
  useEffectsEngine();
  return null;
}

function Debug() {
  const { effects, groups, instances, liveValues, runningEffectIds } = useFixtureStore();
  return (
    <pre data-testid="debug">
      {JSON.stringify({
        effects,
        groups,
        instances: instances.map((i) => ({ id: i.id, group: i.group })),
        liveValues,
        runningEffectIds,
      })}
    </pre>
  );
}

function setup() {
  localStorage.clear();
  return render(
    <FixtureStoreProvider>
      <EffectsEngineMount />
      <GroupsView />
      <EffectsView />
      <Debug />
    </FixtureStoreProvider>,
  );
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

async function createGroupWithFirstFixture(user: ReturnType<typeof userEvent.setup>) {
  vi.spyOn(window, "prompt").mockReturnValueOnce("Grupo Test");
  await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
  const checkboxes = screen.getAllByRole("checkbox");
  await user.click(checkboxes[0]);
  return readDebug().groups[0].id as string;
}

async function createEffect(user: ReturnType<typeof userEvent.setup>, name: string) {
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Nuevo effect/i }));
}

describe("EffectsView — edición de parámetros", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("crea un effect con los defaults esperados (sin grupo, seno, DIMMER, 0-255)", async () => {
    const user = userEvent.setup();
    setup();

    await createEffect(user, "Effect Test");

    const effect = readDebug().effects[0];
    expect(effect.groupId).toBeNull();
    expect(effect.waveform).toBe("sine");
    expect(effect.channelType).toBe("DIMMER");
    expect(effect.min).toBe(0);
    expect(effect.max).toBe(255);
  });

  it("el botón Reproducir está deshabilitado hasta asignar un grupo", async () => {
    const user = userEvent.setup();
    setup();
    await createEffect(user, "Effect Test");

    expect(screen.getByRole("button", { name: /▶ Reproducir/i })).toBeDisabled();

    const groupId = await createGroupWithFirstFixture(user);
    const groupSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(groupSelect, groupId);

    expect(screen.getByRole("button", { name: /▶ Reproducir/i })).toBeEnabled();
  });

  it("borrar un effect que estaba corriendo también lo saca de runningEffectIds", async () => {
    const user = userEvent.setup();
    setup();

    const groupId = await createGroupWithFirstFixture(user);
    await createEffect(user, "Effect Test");
    const groupSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(groupSelect, groupId);
    await user.click(screen.getByRole("button", { name: /▶ Reproducir/i }));
    expect(readDebug().runningEffectIds).toHaveLength(1);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByTitle("Borrar effect"));

    expect(readDebug().effects).toHaveLength(0);
    expect(readDebug().runningEffectIds).toHaveLength(0);
  });
});

describe("EffectsView — reproducción real (timers controlados)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("una onda cuadrada alterna entre min y max, y Detener congela el valor", () => {
    // El motor de effects registra su setInterval al MONTARSE (no al
    // arrancar un effect en particular — ver comentario en
    // lib/effectEngine.ts), así que los timers falsos deben estar activos
    // desde ANTES de renderizar, o ese intervalo quedaría registrado con
    // el setInterval real y vi.advanceTimersByTime no le haría nada.
    // Por la misma razón se usa fireEvent en vez de userEvent en todo
    // este test: userEvent depende de timers reales para sus delays
    // internos y se cuelga si los timers ya están falseados.
    vi.useFakeTimers();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <EffectsEngineMount />
        <GroupsView />
        <EffectsView />
        <Debug />
      </FixtureStoreProvider>,
    );

    vi.spyOn(window, "prompt").mockReturnValueOnce("Grupo Test");
    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    const groupId = readDebug().groups[0].id as string;

    vi.spyOn(window, "prompt").mockReturnValueOnce("Effect Test");
    fireEvent.click(screen.getByRole("button", { name: /\+ Nuevo effect/i }));

    const groupSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(groupSelect, { target: { value: groupId } });
    const waveformSelect = screen.getAllByRole("combobox")[2]; // grupo, tipo de canal, forma de onda
    fireEvent.change(waveformSelect, { target: { value: "square" } });

    const instanceId = readDebug().instances.find((i: { group?: string }) => i.group === groupId).id as string;
    const speedInput = screen.getByLabelText(/Velocidad/i);
    // 60 ciclos/min = 1 ciclo/seg, así el medio ciclo dura exactamente
    // 500ms — fácil de verificar con timers controlados.
    fireEvent.change(speedInput, { target: { value: "60" } });

    const readChannelValue = () => {
      const live = readDebug().liveValues[instanceId] as Record<string, number> | undefined;
      return live ? Object.values(live)[0] : undefined;
    };

    fireEvent.click(screen.getByRole("button", { name: /▶ Reproducir/i }));

    // Justo al arrancar (fase ~0), una cuadrada empieza en el máximo.
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(readChannelValue()).toBe(255);

    // Pasado medio ciclo (500ms a 60 cpm, más un margen porque la fase
    // arranca en el primer tick del motor, ~40ms después del click, no
    // exactamente en t=0) debe haber caído al mínimo.
    act(() => {
      vi.advanceTimersByTime(520);
    });
    expect(readChannelValue()).toBe(0);

    // Detener debe congelar el valor — avanzar más no debe seguir alternando.
    fireEvent.click(screen.getByRole("button", { name: /■ Detener/i }));
    const frozen = readChannelValue();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(readChannelValue()).toBe(frozen);
    expect(readDebug().runningEffectIds).toHaveLength(0);
  });
});
