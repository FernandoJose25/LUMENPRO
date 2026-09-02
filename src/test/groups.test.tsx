import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { GroupsView } from "@/components/groups/GroupsView";

/** Componente de solo lectura para poder inspeccionar el estado interno
 *  del store desde el test, sin exportar internals que no deberían ser
 *  públicos en producción. */
function Debug() {
  const { groups, instances, liveValues } = useFixtureStore();
  return (
    <pre data-testid="debug">
      {JSON.stringify({
        groups,
        instances: instances.map((i) => ({ id: i.id, group: i.group })),
        liveValues,
      })}
    </pre>
  );
}

function setup() {
  localStorage.clear();
  return render(
    <FixtureStoreProvider>
      <GroupsView />
      <Debug />
    </FixtureStoreProvider>,
  );
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

describe("GroupsView — flujo real de usuario", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("crea un grupo nuevo con el prompt de nombre", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Cabezas móviles");
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));

    expect(screen.getByRole("button", { name: /Cabezas móviles/i })).toBeInTheDocument();
    expect(readDebug().groups).toHaveLength(1);
  });

  it("no crea un grupo si se cancela el prompt (regresa null)", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));

    expect(readDebug().groups).toHaveLength(0);
  });

  it("asignar un fixture por checkbox actualiza su group.id, y desmarcar lo desagrupa", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Grupo Test");
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
    const groupId = readDebug().groups[0].id;

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(0); // la semilla trae 6 instancias

    await user.click(checkboxes[0]);
    let state = readDebug();
    const assigned = state.instances.find((i: { group?: string }) => i.group === groupId);
    expect(assigned).toBeTruthy();

    // Desmarcar debe desagrupar (group vuelve a undefined), no borrar el fixture.
    await user.click(checkboxes[0]);
    state = readDebug();
    expect(state.instances.find((i: { id: string }) => i.id === assigned.id).group).toBeUndefined();
  });

  it(
    "mover el fader numérico de Group Control escribe el valor en liveValues " +
      "del fixture miembro, para el tipo de canal correspondiente",
    async () => {
      vi.spyOn(window, "prompt").mockReturnValue("Grupo Test");
      const user = userEvent.setup();
      setup();

      await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[0]); // asigna el primer fixture de la semilla

      const groupId = readDebug().groups[0].id;
      const memberId = readDebug().instances.find((i: { group?: string }) => i.group === groupId).id;

      // Group Control debe mostrar al menos un fader (un tipo de canal en común).
      const sliders = screen.getAllByRole("slider");
      expect(sliders.length).toBeGreaterThan(0);

      // La fila de cada Fader es: <span label> <div role=slider> <div input numérico>.
      const faderRow = sliders[0].parentElement!;
      const numberInput = within(faderRow).getByRole("spinbutton");
      fireEvent.change(numberInput, { target: { value: "200" } });

      const finalLive = readDebug().liveValues[memberId] as Record<string, number>;
      expect(finalLive).toBeTruthy();
      expect(Object.values(finalLive)).toContain(200);
    },
  );

  it("borrar un grupo desagrupa a sus fixtures en vez de borrarlos", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Grupo Test");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /\+ Nuevo grupo/i }));
    const checkboxes = screen.getAllByRole("checkbox");
    await user.click(checkboxes[0]);

    const before = readDebug();
    const groupId = before.groups[0].id;
    const memberId = before.instances.find((i: { group?: string }) => i.group === groupId).id;
    const instanceCountBefore = before.instances.length;

    // El botón de borrar (×) solo es visible al hacer hover (CSS), pero sigue
    // presente en el DOM — se puede clickear igual en jsdom.
    await user.click(screen.getByTitle("Borrar grupo"));

    const after = readDebug();
    expect(after.groups).toHaveLength(0);
    expect(after.instances).toHaveLength(instanceCountBefore); // nadie se borró
    expect(after.instances.find((i: { id: string }) => i.id === memberId).group).toBeUndefined();
  });
});
