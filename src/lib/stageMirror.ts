import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { FrameInput } from "@/lib/dmxFrame";
import { useFixtureStore } from "@/lib/fixtureStore";

/**
 * Simulador en otra ventana, para el segundo monitor. Esa ventana no tiene
 * store ni motores propios (habría dos guardando el show y mandando DMX): solo
 * dibuja lo que la principal le manda por un BroadcastChannel.
 */
const CHANNEL = "lumenpro.stage";
// También dentro de src-tauri/src/main.rs.
const STAGE_HASH = "#escenario";

/** La ventana pide datos mientras siga abierta; si deja de pedir, se cerró. */
const HELLO_MS = 1000;
const GONE_MS = 3000;

export const isStageWindow = () => window.location.hash === STAGE_HASH;

export async function openStageWindow(): Promise<void> {
  if (isTauri()) await invoke("open_stage_window");
  else window.open(`${window.location.pathname}${STAGE_HASH}`, "lumenpro-stage", "popup,width=1280,height=720");
}

/** Lado de la ventana principal. Se monta una sola vez (AppShell). */
export function useStagePublisher(): void {
  const { instances, definitions, liveValues, moving, held, blackoutActive, master, strobeActive, identifyId } =
    useFixtureStore();
  const rig: FrameInput = {
    instances, definitions, liveValues, moving, held, blackoutActive, master, strobeActive, identifyId,
  };
  const rigRef = useRef(rig);
  rigRef.current = rig;

  const channel = useRef<BroadcastChannel | null>(null);
  const lastHello = useRef(-Infinity);

  useEffect(() => {
    const c = new BroadcastChannel(CHANNEL);
    channel.current = c;
    c.onmessage = (e) => {
      if (e.data !== "hello") return;
      lastHello.current = Date.now();
      c.postMessage(rigRef.current);
    };
    return () => c.close();
  }, []);

  useEffect(() => {
    if (Date.now() - lastHello.current < GONE_MS) channel.current?.postMessage(rigRef.current);
  }, [instances, definitions, liveValues, moving, held, blackoutActive, master, strobeActive, identifyId]);
}

/** Lado de la segunda ventana; null hasta que la principal conteste. */
export function useStageMirror(): FrameInput | null {
  const [rig, setRig] = useState<FrameInput | null>(null);

  useEffect(() => {
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e) => {
      if (e.data !== "hello") setRig(e.data as FrameInput);
    };
    const hello = () => c.postMessage("hello");
    hello();
    const timer = setInterval(hello, HELLO_MS);
    return () => {
      clearInterval(timer);
      c.close();
    };
  }, []);

  return rig;
}
