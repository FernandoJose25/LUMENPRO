import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke, isTauri } from "@tauri-apps/api/core";
import App from "@/App";
import type { EngineMessage } from "@/types/engine";
import { fakeEngine } from "./fakeEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(), Channel: class {} }));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

type Engine = ReturnType<typeof fakeEngine>;
const lastDoc = (engine: Engine) => {
  const message = [...engine.applied].reverse().find((m) => m.type === "doc" || m.type === "reset") as Extract<
    EngineMessage,
    { type: "doc" }
  >;
  return message.doc;
};

async function withTemplate() {
  const user = userEvent.setup();
  const engine = fakeEngine();
  render(<App />);
  await user.click(screen.getByRole("button", { name: "Momentos" }));
  await user.click(screen.getByRole("button", { name: "Usar plantilla de quinceañera" }));
  return { user, engine };
}

const confirm = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: label }));

describe("Restablecer", () => {
  it("la plantilla vuelve a como la arma, con los mismos momentos", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Entrada" }));
    fireEvent.change(screen.getByLabelText("Transición (segundos)"), { target: { value: "9" } });
    await user.click(screen.getByRole("button", { name: "Entrada, PAR: Verde" }));
    const before = lastDoc(engine).moments.find((m) => m.name === "Entrada")!;
    expect(before.fadeMs).toBe(9000);

    await user.click(screen.getByRole("button", { name: "Restablecer plantilla" }));
    await confirm(user, "Restablecer");
    const doc = lastDoc(engine);
    const after = doc.moments.find((m) => m.name === "Entrada")!;
    expect(after).toMatchObject({ id: before.id, sceneId: before.sceneId, fadeMs: 2000 });
    expect(doc.moments.filter((m) => m.name === "Entrada")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Entrada, PAR: Violeta" })).toHaveAttribute("aria-pressed", "true");
  });

  it("un effect de la plantilla vuelve a su velocidad", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Effects" }));
    await user.click(screen.getByRole("button", { name: /^PAR: ola roja/ }));
    const speed = screen.getByLabelText(/Velocidad/);
    fireEvent.change(speed, { target: { value: "99" } });
    expect(lastDoc(engine).effects.find((fx) => fx.name === "PAR: ola roja")!.speedCpm).toBe(99);
    await user.click(screen.getByRole("button", { name: "Restablecer" }));
    await confirm(user, "Restablecer");
    expect(lastDoc(engine).effects.find((fx) => fx.name === "PAR: ola roja")!.speedCpm).toBe(30);
  });

  it("todo el show vuelve a como recién instalado", async () => {
    const { user, engine } = await withTemplate();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Restablecer todo (empezar de cero)" }));
    await confirm(user, "Borrar todo");
    await waitFor(() => expect(lastDoc(engine).moments).toEqual([]));
    expect(lastDoc(engine).instances.length).toBeGreaterThan(0);
  });
});
