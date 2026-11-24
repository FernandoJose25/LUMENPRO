import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { buildFrame } from "@/lib/dmxFrame";
import { useFixtureStore } from "@/lib/fixtureStore";

export type DmxAdapter = "open_dmx" | "enttec" | "mock";

export interface SerialPort {
  name: string;
  chip: "ftdi" | "ch340" | "other";
  description: string;
}

export interface EngineStatus {
  state: "stopped" | "running" | "reconnecting";
  output: string;
  lastError: string | null;
  fps: number;
}

const STOPPED: EngineStatus = { state: "stopped", output: "", lastError: null, fps: 0 };

// 30 y no 40: con el cable FTDI el timing lo marca la PC y 512 canales tardan
// 22,6 ms en salir. A 40 no queda margen y parpadea (ver OpenDmxOutput).
const FPS = 30;
const STATUS_POLL_MS = 1000;

export interface DmxOutput {
  /** false en el navegador: ahí no hay motor DMX, solo interfaz. */
  available: boolean;
  status: EngineStatus;
  ports: SerialPort[];
  error: string | null;
  frame: number[];
  refreshPorts: () => Promise<void>;
  connect: (adapter: DmxAdapter, port: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * Puente entre el store y el motor DMX en Rust. Se monta una sola vez
 * (AppShell), igual que useEffectsEngine: la salida no puede depender de qué
 * sección esté abierta.
 */
export function useDmxOutput(): DmxOutput {
  const { instances, definitions, liveValues, blackoutActive } = useFixtureStore();
  const available = isTauri();

  const [status, setStatus] = useState(STOPPED);
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [error, setError] = useState<string | null>(null);

  const frame = useMemo(
    () => buildFrame({ instances, definitions, liveValues, blackoutActive }),
    [instances, definitions, liveValues, blackoutActive],
  );

  const latestFrame = useRef(frame);
  const lastSent = useRef("");
  const sending = useRef(false);

  // Nunca hay más de un envío en vuelo: si la UI cambia más rápido que el
  // IPC, se saltan los frames intermedios y sale el último. El hilo de Rust
  // repite por su cuenta lo que tenga, así que no se pierde señal.
  const flush = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (;;) {
        const values = latestFrame.current;
        const signature = values.join();
        if (signature === lastSent.current) break;
        await invoke("set_block", { startChannel: 1, values });
        lastSent.current = signature;
      }
    } catch (e) {
      setError(String(e));
    } finally {
      sending.current = false;
    }
  }, []);

  useEffect(() => {
    latestFrame.current = frame;
    if (available) void flush();
  }, [available, flush, frame]);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await invoke<EngineStatus>("engine_status");
      setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await invoke<SerialPort[]>("list_serial_ports"));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (!available) return;
    void refreshPorts();
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [available, refreshPorts, refreshStatus]);

  const connect = useCallback(
    async (adapter: DmxAdapter, port: string) => {
      setError(null);
      try {
        if (adapter === "mock") await invoke("connect_mock", { fps: FPS });
        else await invoke(`connect_${adapter}`, { port, fps: FPS });
      } catch (e) {
        setError(String(e));
      }
      await refreshStatus();
    },
    [refreshStatus],
  );

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await invoke("disconnect");
    } catch (e) {
      setError(String(e));
    }
    await refreshStatus();
  }, [refreshStatus]);

  return { available, status, ports, error, frame, refreshPorts, connect, disconnect };
}
