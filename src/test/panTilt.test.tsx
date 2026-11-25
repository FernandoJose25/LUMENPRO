import { describe, it, expect, beforeEach } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { PanTiltPad } from "@/components/fixtures/PanTiltPad";
import { seedDefinitions } from "@/data/fixtureLibrary";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import { readAxis, writeAxis } from "@/lib/panTilt";
import type { FixtureDefinition } from "@/types/fixture";

const orus = seedDefinitions[0];
const idOf = (type: string) => orus.channels.find((c) => c.type === type)!.id;
const [PAN, PAN_FINE, TILT] = [idOf("PAN"), idOf("PAN_FINE"), idOf("TILT")];

describe("Ejes de 16 bits", () => {
  const read = (definition: FixtureDefinition, values: Record<string, number>) =>
    readAxis(definition, "PAN", (c) => values[c.id] ?? c.defaultValue);

  it("va de 0 a 255 en los dos canales y lo que se escribe se lee igual", () => {
    expect(writeAxis(orus, "PAN", 0)).toEqual({ [PAN]: 0, [PAN_FINE]: 0 });
    expect(writeAxis(orus, "PAN", 1)).toEqual({ [PAN]: 255, [PAN_FINE]: 255 });
    for (const at of [0.1, 0.333, 0.5, 0.987]) expect(read(orus, writeAxis(orus, "PAN", at))).toBeCloseTo(at, 4);
  });

  it("fuera del recorrido se queda en el borde", () => {
    expect(writeAxis(orus, "PAN", -3)).toEqual(writeAxis(orus, "PAN", 0));
    expect(writeAxis(orus, "PAN", 3)).toEqual(writeAxis(orus, "PAN", 1));
  });

  it("sin canal fino usa solo el principal, y respeta su mínimo y máximo", () => {
    const limited: FixtureDefinition = {
      ...orus,
      channels: orus.channels
        .filter((c) => c.type !== "PAN_FINE")
        .map((c) => (c.type === "PAN" ? { ...c, dmxMin: 50, dmxMax: 150 } : c)),
    };
    expect(writeAxis(limited, "PAN", 0.5)).toEqual({ [PAN]: 100 });
    expect(read(limited, { [PAN]: 150 })).toBe(1);
  });
});

describe("Pad", () => {
  let store: ReturnType<typeof useFixtureStore>;

  function Harness() {
    store = useFixtureStore();
    return <PanTiltPad instances={store.instances} />;
  }

  beforeEach(() => {
    localStorage.clear();
    // jsdom no mide ni captura el puntero.
    const captured = new Set<number>();
    Element.prototype.setPointerCapture = (id) => void captured.add(id);
    Element.prototype.hasPointerCapture = (id) => captured.has(id);
    Element.prototype.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;
    render(
      <FixtureStoreProvider>
        <Harness />
      </FixtureStoreProvider>,
    );
  });

  // jsdom no tiene PointerEvent: las coordenadas se ponen a mano.
  function pointer(type: "pointerDown" | "pointerMove", clientX: number, clientY: number) {
    const pad = screen.getByRole("application", { name: /^Pan y tilt/ });
    const event = createEvent[type](pad);
    Object.defineProperties(event, {
      clientX: { value: clientX },
      clientY: { value: clientY },
      pointerId: { value: 1 },
    });
    fireEvent(pad, event);
  }
  const live = (instance: number, channelId: string) => store.liveValues[store.instances[instance].id]?.[channelId];

  it("arrastrar apunta todas las cabezas a la vez y no toca los PAR", () => {
    pointer("pointerDown", 10, 20); // esquina de arriba a la izquierda
    expect([live(0, PAN), live(0, TILT)]).toEqual([0, 255]);
    pointer("pointerMove", 210, 120); // abajo a la derecha
    expect([live(0, PAN), live(0, TILT)]).toEqual([255, 0]);
    expect([live(1, PAN), live(1, TILT)]).toEqual([255, 0]);
    expect(store.liveValues[store.instances[2].id]).toBeUndefined();
  });

  it("pasar por encima sin pulsar no mueve nada", () => {
    pointer("pointerMove", 100, 60);
    expect(store.liveValues).toEqual({});
  });

  it("flechas: un valor DMX; con Shift, ajuste fino", () => {
    const pad = screen.getByRole("application", { name: /^Pan y tilt/ });
    fireEvent.keyDown(pad, { key: "ArrowRight" });
    expect(live(0, PAN)).toBe(129);
    const fine = live(0, PAN_FINE)!;
    fireEvent.keyDown(pad, { key: "ArrowRight", shiftKey: true });
    expect(live(0, PAN)).toBe(129);
    expect(live(0, PAN_FINE)! - fine).toBe(32);
  });
});

it("sin cabezas no aparece", () => {
  function OnlyPars() {
    const { instances } = useFixtureStore();
    return <PanTiltPad instances={instances.slice(2)} />;
  }
  render(
    <FixtureStoreProvider>
      <OnlyPars />
    </FixtureStoreProvider>,
  );
  expect(screen.queryByRole("application")).toBeNull();
});
