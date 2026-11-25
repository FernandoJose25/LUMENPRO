import { useCallback, useEffect, useState } from "react";
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

/** El servidor del celular, que vive en el proceso del motor
 *  (src-tauri/src/engine/remote.rs): desde acá solo se enciende y se apaga. */
export function useRemoteControl(): RemoteControl {
  const { engine } = useFixtureStore();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (request: Record<string, unknown>) => {
      try {
        setStatus(await engine.request<RemoteStatus>(request));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [engine],
  );

  const refresh = useCallback(() => call({ cmd: "remoteStatus" }), [call]);
  const setEnabled = useCallback((enabled: boolean) => call({ cmd: "remoteSetEnabled", enabled }), [call]);
  const newPin = useCallback(() => call({ cmd: "remoteNewPin" }), [call]);

  useEffect(() => {
    if (engine.desktop) void refresh();
  }, [engine, refresh]);

  return { available: engine.desktop, status, error, refresh, setEnabled, newPin };
}
