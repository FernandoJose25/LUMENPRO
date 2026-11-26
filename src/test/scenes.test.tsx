import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { willAnswer } from "./dialogs";

function Debug() {
  const { scenes, liveValues, selectedInstance } = useFixtureStore();
  return (
    <pre data-testid="debug">{JSON.stringify({ scenes, liveValues, selectedInstanceId: selectedInstance?.id })}</pre>
  );
}

function setup() {
  localStorage.clear();
  return render(
    <FixtureStoreProvider>
      <FixtureControl picker />
      <ScenesPanel />
      <Debug />
    </FixtureStoreProvider>,
  );
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

function firstFaderNumberInput() {
  const slider = screen.getAllByRole("slider")[0];
  return within(slider.parentElement!).getByRole("spinbutton");
}

describe("Scenes — flujo real de usuario (guardar → cambiar → recuperar)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("guardar una escena captura el valor actual del canal en liveValues", async () => {
    willAnswer("Escena A");
    const user = userEvent.setup();
    setup();

    const input = firstFaderNumberInput();
    fireEvent.change(input, { target: { value: "123" } });

    await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));

    const state = readDebug();
    expect(state.scenes).toHaveLength(1);
    const instanceId = state.selectedInstanceId;
    const savedValues = Object.values(state.scenes[0].values[instanceId] as Record<string, number>);
    expect(savedValues).toContain(123);
  });

  it(
    "recuperar una escena restaura el valor del canal, aunque se haya " +
      "movido el fader después de guardar (merge, no pisa lo no capturado)",
    async () => {
      willAnswer("Escena A");
      const user = userEvent.setup();
      setup();

      const input = firstFaderNumberInput();
      fireEvent.change(input, { target: { value: "123" } });
      await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));

      // Mover el fader a otro valor después de guardar.
      fireEvent.change(firstFaderNumberInput(), { target: { value: "40" } });
      expect(firstFaderNumberInput()).toHaveValue(40);

      // Recuperar la escena debe devolver el fader a 123.
      await user.click(screen.getByRole("button", { name: /Escena A/i }));
      expect(firstFaderNumberInput()).toHaveValue(123);
    },
  );

  it("re-grabar (⟳) actualiza la escena existente con el valor actual", async () => {
    willAnswer("Escena A");
    const user = userEvent.setup();
    setup();

    fireEvent.change(firstFaderNumberInput(), { target: { value: "10" } });
    await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));

    fireEvent.change(firstFaderNumberInput(), { target: { value: "222" } });
    await user.click(screen.getByTitle("Re-grabar con los valores actuales"));

    // Mover a un tercer valor y recuperar: debe volver a 222 (lo re-grabado), no a 10.
    fireEvent.change(firstFaderNumberInput(), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: /Escena A/i }));
    expect(firstFaderNumberInput()).toHaveValue(222);
  });

  it("borrar una escena la quita de la lista y no puede recuperarse más", async () => {
    willAnswer("Escena A");
    willAnswer(true);
    const user = userEvent.setup();
    setup();

    fireEvent.change(firstFaderNumberInput(), { target: { value: "77" } });
    await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));
    expect(readDebug().scenes).toHaveLength(1);

    await user.click(screen.getByTitle("Borrar escena"));
    expect(readDebug().scenes).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Escena A/i })).not.toBeInTheDocument();
  });
});

describe("Fixture Control — elegir las luces", () => {
  it("se eligen varias tocándolas, y siempre queda al menos una", async () => {
    const user = userEvent.setup();
    setup();
    const lights = within(screen.getByRole("group", { name: "Luz a controlar" }));
    const head = lights.getByRole("button", { name: "BEAM 280 ORUS #1" });
    const par = lights.getByRole("button", { name: "LPC007 PAR #1" });
    expect(head).toHaveAttribute("aria-pressed", "true");
    expect(par).toHaveAttribute("aria-pressed", "false");

    await user.click(par);
    expect(head).toHaveAttribute("aria-pressed", "true");
    expect(par).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2 luces")).toBeInTheDocument();

    await user.click(head);
    expect(head).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/· DMX 33$/)).toBeInTheDocument();

    await user.click(par);
    expect(par).toHaveAttribute("aria-pressed", "true");
  });

  it("de un toque todas o las de un modelo, y un fader mueve a todas las de su modelo", async () => {
    const user = userEvent.setup();
    setup();
    const sets = within(screen.getByRole("group", { name: "Elegir varias" }));
    await user.click(sets.getByRole("button", { name: "Todas (6)" }));
    expect(screen.getByText("6 luces")).toBeInTheDocument();

    const pars = within(screen.getByRole("region", { name: "LPC007 (PAR LED RGB 3in1)" }));
    fireEvent.change(pars.getAllByRole("spinbutton")[0], { target: { value: "100" } });
    const lit = Object.values(readDebug().liveValues as Record<string, Record<string, number>>).filter((channels) =>
      Object.values(channels).includes(100),
    );
    expect(lit).toHaveLength(4);

    await user.click(sets.getByRole("button", { name: "280W 3in1 Moving Head (2)" }));
    expect(screen.getByText("2 luces")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "LPC007 (PAR LED RGB 3in1)" })).toBeNull();
  });
});
