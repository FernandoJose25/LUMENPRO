import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { GroupsView } from "@/components/groups/GroupsView";
import { EffectsView } from "@/components/effects/EffectsView";
import { ChasesView } from "@/components/chases/ChasesView";
import { LiveView } from "@/components/live/LiveView";

function Debug() {
  const { scenes, groups, instances, chases, effects, liveValues, runningEffectIds } = useFixtureStore();
  return (
    <pre data-testid="debug">
      {JSON.stringify({
        scenes,
        groups,
        chases,
        effects,
        runningEffectIds,
        instances: instances.map((i) => ({ id: i.id, group: i.group })),
        liveValues,
      })}
    </pre>
  );
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

/** FixtureControl es el único componente con Fader montado cuando no hay
 *  grupos con miembros todavía (ver comentario igual en chases.test.tsx),
 *  así que el primer slider siempre es el suyo. */
function firstFaderNumberInput() {
  const slider = screen.getAllByRole("slider")[0];
  return within(slider.parentElement!).getByRole("spinbutton");
}

async function saveSceneWithValue(user: ReturnType<typeof userEvent.setup>, value: number, name: string) {
  fireEvent.change(firstFaderNumberInput(), { target: { value: String(value) } });
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));
}

async function createGroupWithFirstFixture(user: ReturnType<typeof userEvent.setup>, name: string) {
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
  const checkboxes = screen.getAllByRole("checkbox");
  await user.click(checkboxes[0]);
  return readDebug().groups[0].id as string;
}

async function createGroupWithoutMembers(user: ReturnType<typeof userEvent.setup>, name: string) {
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
  return readDebug().groups[readDebug().groups.length - 1].id as string;
}

async function createEffect(user: ReturnType<typeof userEvent.setup>, name: string) {
  vi.spyOn(window, "prompt").mockReturnValueOnce(name);
  await user.click(screen.getByRole("button", { name: /\+ Nuevo effect/i }));
}

describe("LiveView — disparo de escenas, effects, grupos y blackout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("recuperar una escena desde Live Mode aplica los valores guardados (merge, no pisa el resto)", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <FixtureControl />
        <ScenesPanel />
        <LiveView />
        <Debug />
      </FixtureStoreProvider>,
    );

    await saveSceneWithValue(user, 200, "Escena A");
    // Bajar el valor en vivo para confirmar que "recuperar" lo restaura,
    // no que ya estaba ahí por casualidad.
    fireEvent.change(firstFaderNumberInput(), { target: { value: "0" } });

    const instanceId = readDebug().scenes[0] ? Object.keys(readDebug().scenes[0].values)[0] : undefined;
    const channelId = instanceId ? Object.keys(readDebug().scenes[0].values[instanceId])[0] : undefined;
    expect(readDebug().liveValues[instanceId!]?.[channelId!]).toBe(0);

    // ScenesPanel también renderiza un botón "Escena A" propio (para
    // re-grabar/recuperar en el flujo de edición) — hay que acotar la
    // búsqueda al panel "ESCENAS — LIVE" para no ser ambiguo.
    const liveScenesPanel = screen.getByText("ESCENAS — LIVE").closest(".rounded-panel") as HTMLElement;
    await user.click(within(liveScenesPanel).getByRole("button", { name: "Escena A" }));

    expect(readDebug().liveValues[instanceId!][channelId!]).toBe(200);
  });

  it("reproducir/detener un effect desde Live Mode actualiza runningEffectIds", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <GroupsView />
        <EffectsView />
        <LiveView />
        <Debug />
      </FixtureStoreProvider>,
    );

    const groupId = await createGroupWithFirstFixture(user, "Grupo Test");
    await createEffect(user, "Effect Test");
    const groupSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(groupSelect, groupId);

    // El botón de Live Mode incluye el prefijo ▶/■, a diferencia del
    // botón de selección de EffectsView (que solo muestra el nombre) —
    // eso evita ambigüedad entre los dos "Effect Test" en pantalla.
    await user.click(screen.getByRole("button", { name: /▶ Effect Test/i }));
    expect(readDebug().runningEffectIds).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: /■ Effect Test/i }));
    expect(readDebug().runningEffectIds).toHaveLength(0);
  });

  it("mover el fader master de un grupo en Live Mode escribe en liveValues del miembro", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <GroupsView />
        <LiveView />
        <Debug />
      </FixtureStoreProvider>,
    );

    const groupId = await createGroupWithFirstFixture(user, "Grupo Test");
    const memberId = readDebug().instances.find((i: { group?: string }) => i.group === groupId).id;

    // Los títulos de panel son distintos ("GROUPS — MASTER" vs "GROUP
    // CONTROL — Grupo Test"), así que no hay ambigüedad al ubicar el de
    // Live Mode aunque GroupsView también tenga faders para el mismo grupo.
    const liveGroupsPanel = screen.getByText("GROUPS — MASTER").closest(".rounded-panel") as HTMLElement;
    const slider = within(liveGroupsPanel).getAllByRole("slider")[0];
    const numberInput = within(slider.parentElement!).getByRole("spinbutton");
    fireEvent.change(numberInput, { target: { value: "200" } });

    const finalLive = readDebug().liveValues[memberId] as Record<string, number>;
    expect(Object.values(finalLive)).toContain(200);
  });

  it("Blackout desde Live Mode pone todo el rig en 0 y detiene los effects corriendo", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <FixtureControl />
        <GroupsView />
        <EffectsView />
        <LiveView />
        <Debug />
      </FixtureStoreProvider>,
    );

    // Grupo sin miembros a propósito: el effect solo necesita groupId
    // para poder arrancar, y así no aparecen sliders duplicados de
    // GroupsView que compliquen firstFaderNumberInput() más abajo.
    const groupId = await createGroupWithoutMembers(user, "Grupo Vacío");
    await createEffect(user, "Effect Test");
    const groupSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(groupSelect, groupId);
    await user.click(screen.getByRole("button", { name: /▶ Effect Test/i }));
    expect(readDebug().runningEffectIds).toHaveLength(1);

    fireEvent.change(firstFaderNumberInput(), { target: { value: "180" } });
    const instanceId = readDebug().instances[0].id as string;
    const channelId = Object.keys(readDebug().liveValues[instanceId])[0];
    expect(readDebug().liveValues[instanceId][channelId]).toBe(180);

    await user.click(screen.getByRole("button", { name: "BLACKOUT" }));
    await user.click(screen.getByRole("button", { name: "CONFIRMAR" }));

    expect(readDebug().runningEffectIds).toHaveLength(0);
    expect(readDebug().liveValues[instanceId][channelId]).toBe(0);
  });
});

describe("LiveView — reproducción de chases", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproducir un chase desde Live Mode lo pone en marcha, y Detener lo para", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    // Fase 1: construir el chase con la UI de edición real de ChasesView
    // (Live Mode deliberadamente no tiene creación — ver comentario en
    // LiveView.tsx). Fase 2 (más abajo) reemplaza el árbol por LiveView,
    // reusando el mismo FixtureStoreProvider (rerender preserva su estado
    // porque sigue siendo el mismo tipo de componente en la misma
    // posición del árbol) para operar sobre los datos ya creados.
    const { rerender } = render(
      <FixtureStoreProvider>
        <FixtureControl />
        <ScenesPanel />
        <ChasesView />
        <Debug />
      </FixtureStoreProvider>,
    );

    await saveSceneWithValue(user, 200, "Escena A");
    vi.spyOn(window, "prompt").mockReturnValueOnce("Chase Test");
    await user.click(screen.getByRole("button", { name: /\+ Nuevo chase/i }));
    await user.selectOptions(screen.getByRole("combobox"), "Escena A");
    await user.click(screen.getByRole("button", { name: /\+ Agregar step/i }));
    expect(readDebug().chases[0].steps).toHaveLength(1);

    rerender(
      <FixtureStoreProvider>
        <LiveView />
        <Debug />
      </FixtureStoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Chase Test" }));
    await user.click(screen.getByRole("button", { name: /▶ Reproducir/i }));

    expect(await screen.findByText(/step 1\/1/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /■ Detener/i }));
    expect(screen.queryByText(/step 1\/1/)).not.toBeInTheDocument();
  });
});
