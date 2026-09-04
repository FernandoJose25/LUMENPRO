import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { FixtureControl } from "@/components/fixtures/FixtureControl";
import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { CommandPalette } from "@/components/command-palette/CommandPalette";
import { SECTIONS } from "@/components/layout/Sidebar";

function Debug() {
  const { scenes, liveValues } = useFixtureStore();
  return <pre data-testid="debug">{JSON.stringify({ scenes, liveValues })}</pre>;
}

function readDebug() {
  return JSON.parse(screen.getByTestId("debug").textContent!);
}

/** Reemplaza el trocito de AppShell (App.tsx) que le da a CommandPalette
 *  la sección activa y el callback de navegación — sin montar App entero
 *  (que arrastra Topbar/Sidebar/todas las vistas) solo para probar la
 *  paleta. */
function Harness({ withFixtureUi }: { withFixtureUi?: boolean }) {
  const [section, setSection] = useState("Dashboard");
  return (
    <>
      {withFixtureUi ? (
        <>
          <FixtureControl />
          <ScenesPanel />
        </>
      ) : null}
      <span data-testid="section">{section}</span>
      <CommandPalette sections={SECTIONS} activeSection={section} onSelectSection={setSection} />
      <Debug />
    </>
  );
}

function firstFaderNumberInput() {
  const slider = screen.getAllByRole("slider")[0];
  return within(slider.parentElement!).getByRole("spinbutton");
}

const OPEN_PLACEHOLDER = /Ir a una sección/i;

function openPalette() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Ctrl/Cmd+K abre la paleta y Escape la cierra", () => {
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <Harness />
      </FixtureStoreProvider>,
    );

    expect(screen.queryByPlaceholderText(OPEN_PLACEHOLDER)).not.toBeInTheDocument();

    openPalette();
    expect(screen.getByPlaceholderText(OPEN_PLACEHOLDER)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(OPEN_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it('el comando "Ir a <sección>" navega y cierra la paleta', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <Harness />
      </FixtureStoreProvider>,
    );

    openPalette();
    await user.type(screen.getByPlaceholderText(OPEN_PLACEHOLDER), "Fixtures");
    // El nombre accesible concatena el badge de grupo ("Navegar") con la
    // etiqueta ("Ir a Fixtures") sin espacio entre medio — de ahí el regex
    // en vez de un string exacto.
    await user.click(screen.getByRole("button", { name: /Ir a Fixtures/i }));

    expect(screen.getByTestId("section")).toHaveTextContent("Fixtures");
    expect(screen.queryByPlaceholderText(OPEN_PLACEHOLDER)).not.toBeInTheDocument();
  });

  it("recuperar una escena desde un comando aplica sus valores guardados", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <Harness withFixtureUi />
      </FixtureStoreProvider>,
    );

    fireEvent.change(firstFaderNumberInput(), { target: { value: "200" } });
    vi.spyOn(window, "prompt").mockReturnValueOnce("Escena A");
    await user.click(screen.getByRole("button", { name: /\+ Guardar escena/i }));
    fireEvent.change(firstFaderNumberInput(), { target: { value: "0" } });

    const instanceId = Object.keys(readDebug().scenes[0].values)[0];
    const channelId = Object.keys(readDebug().scenes[0].values[instanceId])[0];
    expect(readDebug().liveValues[instanceId][channelId]).toBe(0);

    openPalette();
    await user.type(screen.getByPlaceholderText(OPEN_PLACEHOLDER), "Escena A");
    await user.click(screen.getByRole("button", { name: /Recuperar escena "Escena A"/i }));

    expect(readDebug().liveValues[instanceId][channelId]).toBe(200);
  });

  it("el comando Blackout apaga todo el rig", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <Harness withFixtureUi />
      </FixtureStoreProvider>,
    );

    fireEvent.change(firstFaderNumberInput(), { target: { value: "180" } });
    const instanceId = Object.keys(readDebug().liveValues)[0];
    const channelId = Object.keys(readDebug().liveValues[instanceId])[0];
    expect(readDebug().liveValues[instanceId][channelId]).toBe(180);

    openPalette();
    await user.type(screen.getByPlaceholderText(OPEN_PLACEHOLDER), "Blackout");
    await user.click(screen.getByRole("button", { name: /BLACKOUT — apagar todo el rig/i }));

    expect(readDebug().liveValues[instanceId][channelId]).toBe(0);
  });
});
