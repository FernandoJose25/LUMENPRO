import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { StageView } from "@/components/stage/StageView";
import { useStageMirror, useStagePublisher } from "@/lib/stageMirror";
import type { FrameInput } from "@/lib/dmxFrame";

let store: ReturnType<typeof useFixtureStore>;
let mirror: FrameInput | null;

function Main() {
  store = useFixtureStore();
  useStagePublisher();
  return null;
}

// Va fuera del Provider, como en la segunda ventana.
function Second() {
  mirror = useStageMirror();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  mirror = null;
});

describe("Simulador en otra ventana", () => {
  it("recibe el estado actual al abrirse y cada cambio después", async () => {
    render(
      <FixtureStoreProvider>
        <Main />
      </FixtureStoreProvider>,
    );
    act(() => store.setMaster(40));
    const second = render(<Second />);
    await waitFor(() => expect(mirror?.master).toBe(40));
    expect(mirror!.instances).toEqual(store.instances);

    act(() => store.blackout());
    await waitFor(() => expect(mirror!.blackoutActive).toBe(true));
    second.unmount();
  });

  it("sola, sin la principal, no dibuja nada inventado", async () => {
    render(<Second />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mirror).toBeNull();
  });

  it("en el navegador el botón abre una ventana aparte", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <FixtureStoreProvider>
        <StageView />
      </FixtureStoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir en otra pantalla" }));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/#escenario$/), "lumenpro-stage", expect.any(String));
  });
});
