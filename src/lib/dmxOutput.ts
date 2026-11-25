import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFixtureStore } from "@/lib/fixtureStore";
import { readSetting, writeSetting } from "@/lib/settings";
import type { DmxAdapter, EngineStatus, OutputConfig } from "@/types/engine";

export interface SerialPort {
  name: string;
  chip: "ftdi" | "ch340" | "other";
  description: string;
}

/** Nodo Art-Net que contestó en la red. */
export interface ArtNetNode {
  ip: string;
  name: string;
  universes: number[];
}

export const ADAPTER_LABELS: Record<DmxAdapter, string> = {
  open_dmx: "Cable FTDI (Open DMX)",
  enttec: "Enttec DMX USB PRO",
  artnet: "Art-Net (red)",
  sacn: "sACN / E1.31 (red)",
  mock: "Simulado (sin cable)",
};
export const isNetwork = (adapter: DmxAdapter) => adapter === "artnet" || adapter === "sacn";
export const isUsb = (adapter: DmxAdapter) => adapter === "open_dmx" || adapter === "enttec";

// 30 y no 40: con el cable FTDI el timing lo marca la PC y 512 canales tardan
// 22,6 ms en salir. A 40 casi no queda margen (ver OpenDmxOutput).
export const DEFAULT_FPS = 30;

/** Las salidas conectadas. Si la app se cierra en pleno evento, al abrirla las
 *  luces vuelven sin tocar nada. Quitar una la olvida. */
const SAVED = "dmx.outputs";

export interface DmxOutput {
  /** false en el navegador: ahí no hay motor DMX, solo interfaz. */
  available: boolean;
  status: EngineStatus;
  ports: SerialPort[];
  error: string | null;
  refreshPorts: () => Promise<void>;
  /** true si se pudo abrir. */
  add: (output: Omit<OutputConfig, "id">) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  findNodes: () => Promise<ArtNetNode[]>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function savedOutputs(): OutputConfig[] {
  const saved = readSetting<OutputConfig[]>(SAVED);
  if (saved) return saved;
  // Hasta la versión anterior había una sola.
  const last = readSetting<{ adapter: DmxAdapter; port: string; fps?: number }>("dmx.last");
  return last
    ? [{ id: "1", universe: 1, fps: last.fps ?? DEFAULT_FPS, host: "", target: 0, adapter: last.adapter, port: last.port }]
    : [];
}

/** Las salidas DMX. Se monta una sola vez (AppShell). */
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

  /** Cambia las salidas y recuerda cómo quedaron. */
  const change = useCallback(
    async (request: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      try {
        const next = await engine.request<EngineStatus>(request);
        engine.noteDmx(next);
        writeSetting(
          SAVED,
          next.outputs.map((o) => o.config),
        );
        return true;
      } catch (e) {
        setError(message(e));
        return false;
      }
    },
    [engine],
  );

  useEffect(() => {
    // Con un show en marcha las salidas ya están como deben.
    if (!available || engine.resumed) return;
    const outputs = savedOutputs();
    if (outputs.length > 0) void change({ cmd: "setOutputs", outputs });
  }, [available, change, engine]);

  const add = useCallback(
    (output: Omit<OutputConfig, "id">) =>
      change({ cmd: "addOutput", output: { ...output, id: `out-${crypto.randomUUID()}` } }),
    [change],
  );
  const remove = useCallback(
    async (id: string) => {
      await change({ cmd: "removeOutput", id });
    },
    [change],
  );
  const findNodes = useCallback(async () => {
    setError(null);
    try {
      return await engine.request<ArtNetNode[]>({ cmd: "discoverArtnet" });
    } catch (e) {
      setError(message(e));
      return [];
    }
  }, [engine]);

  return { available, status, ports, error, refreshPorts, add, remove, findNodes };
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
