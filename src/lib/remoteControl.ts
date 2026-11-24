import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { EngineStatus } from "@/lib/dmxOutput";
import { useFixtureStore } from "@/lib/fixtureStore";

export interface RemoteAddress {
  url: string;
  qrSize: number;
  qrPath: string;
}

export interface RemoteStatus {
  running: boolean;
  pin: string;
  error: string | null;
  addresses: RemoteAddress[];
}

export interface RemoteControl {
  /** false en el navegador: ahí no hay servidor. */
  available: boolean;
  status: RemoteStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  newPin: () => Promise<void>;
}

type Store = ReturnType<typeof useFixtureStore>;

/** Ejecuta una orden del celular (ver src-tauri/src/remote.html). Lo que no
 *  reconoce lo ignora: el servidor solo hace de relevo, no valida. */
export function applyRemoteCommand(command: unknown, store: Store): void {
  if (typeof command !== "object" || command === null) return;
  const { type, from, id, on, value } = command as Record<string, unknown>;
  switch (type) {
    case "next":
    case "prev":
      // Doble toque, o dos celulares a la vez: el segundo ya no coincide.
      if (from === store.activeMomentId) store.stepMoment(type === "next" ? 1 : -1);
      break;
    case "moment":
      if (typeof id === "string") store.startMoment(id);
      break;
    case "stop":
      store.stopMoment();
      break;
    case "blackout":
      if (on === true) store.blackout();
      if (on === false) store.releaseBlackout();
      break;
    case "strobe":
      if (typeof on === "boolean") store.setStrobe(on);
      break;
    case "master":
      if (typeof value === "number") store.setMaster(value);
      break;
  }
}

/** Une el servidor del celular (src-tauri/src/remote.rs) con el store. Se
 *  monta una sola vez, en AppShell. */
export function useRemoteControl(dmxState: EngineStatus["state"]): RemoteControl {
  const store = useFixtureStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const available = isTauri();

  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (command: string, args?: Record<string, unknown>) => {
    try {
      setStatus(await invoke<RemoteStatus>(command, args));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    const onCommand = new Channel<unknown>();
    onCommand.onmessage = (command) => applyRemoteCommand(command, storeRef.current);
    void call("remote_attach", { onCommand });
  }, [available, call]);

  // Solo lo que el celular muestra: liveValues cambia 25 veces por segundo y
  // no le interesa.
  const { moments, activeMomentId, momentRun, blackoutActive, strobeActive, master } = store;
  const snapshot = useMemo(
    () =>
      JSON.stringify({
        moments: moments.map(({ id, name, durationSec }) => ({ id, name, durationSec })),
        activeId: activeMomentId,
        startedAt: momentRun?.startedAt ?? null,
        blackout: blackoutActive,
        strobe: strobeActive,
        master,
        dmx: dmxState,
      }),
    [moments, activeMomentId, momentRun, blackoutActive, strobeActive, master, dmxState],
  );

  useEffect(() => {
    if (available) invoke("remote_publish", { snapshot }).catch((e) => setError(String(e)));
  }, [available, snapshot]);

  const refresh = useCallback(() => call("remote_status"), [call]);
  const setEnabled = useCallback((enabled: boolean) => call("remote_set_enabled", { enabled }), [call]);
  const newPin = useCallback(() => call("remote_new_pin"), [call]);

  return { available, status, error, refresh, setEnabled, newPin };
}
