import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFixtureStore } from "@/lib/fixtureStore";
import { readSetting, writeSetting } from "@/lib/settings";
import type { EngineStatus } from "@/types/engine";

export type DmxAdapter = "open_dmx" | "enttec" | "mock";

export interface SerialPort {
  name: string;
  chip: "ftdi" | "ch340" | "other";
  description: string;
}

// 30 y no 40: con el cable FTDI el timing lo marca la PC y 512 canales tardan
// 22,6 ms en salir. A 40 casi no queda margen (ver OpenDmxOutput).
export const DEFAULT_FPS = 30;

/** Último adaptador conectado. Si la app se cierra en pleno evento, al abrirla
 *  las luces vuelven sin tocar nada. "Desconectar" lo olvida. */
const LAST_KEY = "dmx.last";

export interface DmxOutput {
  /** false en el navegador: ahí no hay motor DMX, solo interfaz. */
  available: boolean;
  status: EngineStatus;
  ports: SerialPort[];
  error: string | null;
  refreshPorts: () => Promise<void>;
  connect: (adapter: DmxAdapter, port: string, fps: number) => Promise<void>;
  disconnect: () => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** La conexión con el adaptador. Se monta una sola vez (AppShell). */
export function useDmxOutput(): DmxOutput {
  const { engine } = useFixtureStore();
  const available = engine.desktop;
  const status = useSyncExternalStore(engine.subscribeDmx, engine.dmxStatus);

  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await invoke<SerialPort[]>("list_serial_ports"));
    } catch (e) {
      setError(message(e));
    }
  }, []);

  useEffect(() => {
    if (available) void refreshPorts();
  }, [available, refreshPorts]);

  const connect = useCallback(
    async (adapter: DmxAdapter, port: string, fps: number) => {
      setError(null);
      try {
        await engine.request({ cmd: "connect", adapter, port, fps });
        writeSetting(LAST_KEY, { adapter, port, fps });
      } catch (e) {
        setError(message(e));
      }
    },
    [engine],
  );

  useEffect(() => {
    // Con un show en marcha la salida ya está como debe.
    if (!available || engine.resumed) return;
    const last = readSetting<{ adapter: DmxAdapter; port: string; fps?: number }>(LAST_KEY);
    if (last) void connect(last.adapter, last.port, last.fps ?? DEFAULT_FPS);
  }, [available, connect, engine]);

  const disconnect = useCallback(async () => {
    writeSetting(LAST_KEY, null);
    setError(null);
    try {
      await engine.request({ cmd: "disconnect" });
    } catch (e) {
      setError(message(e));
    }
  }, [engine]);

  return { available, status, ports, error, refreshPorts, connect, disconnect };
}

const FRAME_REFRESH_MS = 100;

/** Los 512 canales que están saliendo, para verlos en pantalla. */
export function useOutputFrame(universe: number): number[] {
  const { engine } = useFixtureStore();
  const [frame, setFrame] = useState<number[]>([]);

  useEffect(() => {
    const read = () => engine.readFrame(universe, setFrame);
    read();
    const timer = setInterval(read, FRAME_REFRESH_MS);
    return () => clearInterval(timer);
  }, [engine, universe]);

  return frame;
}
