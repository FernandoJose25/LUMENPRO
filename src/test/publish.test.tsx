import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { VERSION } from "@/lib/updates";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.unstubAllGlobals();
});

describe("Versiones", () => {
  it("la versión es la misma en todos lados", () => {
    const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
    const cargo = /^version = "(.*)"/m.exec(readFileSync("src-tauri/Cargo.toml", "utf8"))![1];
    expect([VERSION, cargo]).toEqual([tauri, tauri]);
  });

  it("avisa de una versión nueva con sus novedades y la instala", async () => {
    const user = userEvent.setup();
    fakeEngine({ check_update: () => ({ version: "99.0.0", notes: "Color fijo desde el celular" }) });
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Actualización disponible" });
    expect(within(dialog).getByText("Color fijo desde el celular")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Instalar ahora" }));
    expect(invoke).toHaveBeenCalledWith("install_update", expect.objectContaining({ progress: expect.anything() }));
    expect(within(dialog).getByRole("status")).toHaveTextContent("Descargando");
  });

  it("si se deja para después, queda un botón para volver a verlo", async () => {
    const user = userEvent.setup();
    fakeEngine({ check_update: () => ({ version: "99.0.0", notes: null }) });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Versión nueva: 99.0.0" }));
    expect(screen.getByRole("dialog", { name: "Actualización disponible" })).toBeInTheDocument();
  });

  it("sin internet, o al día, no dice nada", async () => {
    for (const reply of [() => Promise.reject(new Error("sin red")), () => null]) {
      const check = vi.fn(reply);
      fakeEngine({ check_update: check });
      const view = render(<App />);
      await waitFor(() => expect(check).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole("button", { name: /Versión nueva/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("Guía", () => {
  it("está dentro del programa, con sus pasos", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render(<App />);
    screen.getByRole("button", { name: "Guía" }).click();
    expect(await screen.findByRole("heading", { name: "Guía de LUMEN PRO" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "4. Armar la quinceañera" })).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(6);
  });

  it("solo nombra secciones y botones que existen", () => {
    const guide = readFileSync("docs/GUIA.md", "utf8");
    const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
    const sections = [...sidebar.matchAll(/^ {2}"([^"]+)",$/gm)].map((m) => m[1]);
    for (const name of ["Fixtures", "Escenario", "Momentos", "Dashboard", "Scenes", "Effects", "Paletas", "DMX Output", "Celular", "Audio Reactive", "Live", "MIDI", "Settings"]) {
      expect(sections).toContain(name);
      expect(guide).toContain(`**${name}`);
    }
    const sources = ["FixtureManager", "MomentsView", "StageView", "DmxOutputView", "RemoteView", "AudioView", "SettingsView"]
      .map((c) => readFileSync(`src/components/${{ FixtureManager: "fixtures", MomentsView: "moments", StageView: "stage", DmxOutputView: "dmx", RemoteView: "remote", AudioView: "audio", SettingsView: "views" }[c]}/${c}.tsx`, "utf8"))
      .join("\n");
    for (const button of ["+ Elegir de la biblioteca", "+ Equipo sin manual", "Usar plantilla de quinceañera", "Apuntar", "Identificar", "Encender", "Escuchar", "Exportar show"]) {
      expect(sources, button).toContain(button);
    }
  });
});
