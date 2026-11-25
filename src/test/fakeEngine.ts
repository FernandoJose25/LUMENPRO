import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { WasmShow } from "@/lib/wasmEngine";
import type { EngineMessage, EngineStatus, OutputConfig, OutputStatus, Session } from "@/types/engine";

type Args = Record<string, unknown>;
type Request = { cmd: string } & Args;

export const ADDRESSES = [
  { url: "http://192.168.1.20:8777", qrSize: 25, qrPath: "M0,0h1v1h-1z" },
  { url: "http://192.168.137.1:8777", qrSize: 25, qrPath: "M1,0h1v1h-1z" },
];

/**
 * El proceso del motor, de mentira: mismas respuestas que src-tauri/src/engine
 * pero con el motor del show de verdad (WASM) adentro. Requiere
 * vi.mock("@tauri-apps/api/core").
 */
export function fakeEngine(overrides: Record<string, (args: Args) => unknown> = {}) {
  const state = {
    show: new WasmShow(),
    bootId: "motor-1",
    ack: 0,
    outputs: [] as OutputStatus[],
    remote: { running: false, pin: "123456", error: null as string | null, addresses: ADDRESSES },
    session: null as Session | null,
    listening: false,
    focus: false,
    requests: [] as Request[],
    events: null as { onmessage: (event: unknown) => void } | null,
    /** Órdenes aplicadas, en el orden en que llegaron. */
    applied: [] as EngineMessage[],
    waiters: [] as (() => void)[],
  };
  const NAMES = { mock: "Mock (sin hardware)", open_dmx: "Cable FTDI", enttec: "Enttec", artnet: "Art-Net", sacn: "sACN" };
  const running = (config: OutputConfig): OutputStatus => ({
    config,
    state: "running",
    name: config.port ? `${NAMES[config.adapter]} (${config.port})` : NAMES[config.adapter],
    lastError: null,
    fps: 30,
    worstGapMs: 35,
  });
  const dmx = (): EngineStatus => ({
    state: state.outputs.length === 0 ? "stopped" : (state.outputs.find((o) => o.state !== "running")?.state ?? "running"),
    outputs: state.outputs,
  });

  const changed = () => state.waiters.splice(0).forEach((wake) => wake());

  const commands: Record<string, (r: Request) => unknown> = {
    send: ({ seq, messages }) => {
      for (const message of messages as EngineMessage[]) {
        state.show.send(message, Date.now());
        state.applied.push(message);
      }
      state.ack = seq as number;
      state.show.tick(Date.now());
      changed();
      return { ack: seq, error: null };
    },
    wait: async ({ since }) => {
      state.show.tick(Date.now());
      let changes = state.show.changes(since as number);
      if (!changes) {
        await new Promise<void>((resolve) => {
          state.waiters.push(resolve);
          setTimeout(resolve, 60);
        });
        state.show.tick(Date.now());
        changes = state.show.changes(since as number);
      }
      const focus = state.focus;
      state.focus = false;
      return { bootId: state.bootId, ack: state.ack, changes, dmx: dmx(), focus };
    },
    frame: ({ universe }) => state.show.frame(universe as number),
    addOutput: ({ output }) => {
      state.outputs = [...state.outputs, running(output as OutputConfig)];
      return dmx();
    },
    setOutputs: ({ outputs }) => {
      state.outputs = (outputs as OutputConfig[]).map(running);
      return dmx();
    },
    removeOutput: ({ id }) => {
      state.outputs = state.outputs.filter((o) => o.config.id !== id);
      return dmx();
    },
    discoverArtnet: () => [],
    remoteStatus: () => ({ ...state.remote }),
    remoteSetEnabled: ({ enabled }) => ({ ...Object.assign(state.remote, { running: enabled }) }),
    remoteNewPin: () => ({ ...Object.assign(state.remote, { pin: "654321" }) }),
  };

  const handlers: Record<string, (args: Args) => unknown> = {
    list_serial_ports: () => [
      { name: "COM1", chip: "other", description: "" },
      { name: "COM5", chip: "ftdi", description: "USB Serial Port (COM5)" },
    ],
    engine_attach: ({ onEvent }) => {
      state.events = onEvent as typeof state.events;
      return JSON.stringify({ ok: { bootId: state.bootId, session: state.session, listening: state.listening } });
    },
    engine_call: async (args) => {
      const request = JSON.parse(args.request as string) as Request;
      state.requests.push(request);
      try {
        const override = overrides[request.cmd];
        return JSON.stringify({ ok: (await (override ?? commands[request.cmd])(request)) ?? null });
      } catch (e) {
        return JSON.stringify({ error: String(e) });
      }
    },
    ...overrides,
  };
  vi.mocked(invoke).mockImplementation(async (cmd, args) => handlers[cmd]?.((args ?? {}) as Args));

  return {
    ...state,
    state,
    commands,
    frame: () => state.show.frame(1),
    sent: (cmd: string) => state.requests.filter((r) => r.cmd === cmd),
    /** El motor se cayó y el guardián levantó otro, que retomó o no el show. */
    crash: (session: Session | null) => {
      state.bootId = "motor-2";
      state.session = session;
      state.show = new WasmShow();
      changed();
    },
    changed,
  };
}
