import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import { fakeEngine } from "./fakeEngine";
import { willAnswer } from "./dialogs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("Respaldos automáticos", () => {
  it("cada guardado lleva el día, y un respaldo se recupera desde Settings", async () => {
    const user = userEvent.setup();
    const old = JSON.stringify({ definitions: [], instances: [], moments: [{ id: "m", name: "Del respaldo", sceneId: null, chaseId: null, effectIds: [], fadeMs: 0, durationSec: null }] });
    fakeEngine({ list_backups: () => ["2026-11-26", "2026-11-25"], read_backup: ({ day }) => (day === "2026-11-26" ? old : "{}") });
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([cmd]) => cmd === "save_show")).toBe(true));
    const [, args] = vi.mocked(invoke).mock.calls.find(([cmd]) => cmd === "save_show")!;
    expect((args as { day: string }).day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("RESPALDOS AUTOMÁTICOS")).toBeInTheDocument();
    willAnswer(true);
    await user.click(screen.getAllByRole("button", { name: "Recuperar" })[0]);
    expect(await screen.findByText(/Show recuperado: como estaba el jueves 26 de noviembre/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Momentos" }));
    expect(screen.getByRole("button", { name: "Del respaldo" })).toBeInTheDocument();
  });
});
