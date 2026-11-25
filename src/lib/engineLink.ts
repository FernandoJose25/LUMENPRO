import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { getAudioFeed } from "@/lib/audioInput";
import type { ChannelValues } from "@/lib/fade";
import { fetchWasm, WasmShow } from "@/lib/wasmEngine";
import {
  DMX_STOPPED,
  type AudioMessage,
  type EngineChanges,
  type EngineMessage,
  type EngineStatus,
  type Session,
} from "@/types/engine";

/**
 * Cómo habla la interfaz con el motor del show. En la app de escritorio el
 * motor es otro proceso (src-tauri/src/engine/) y sigue aunque la ventana se
 * trabe; en el navegador corre acá mismo, en WASM.
 */
export interface EngineLink {
  /** false en el navegador: no hay salida DMX ni celular. */
  readonly desktop: boolean;
  /** El motor ya tenía un show en marcha: no hay que mandarle el del disco. */
  readonly resumed: Session | null;
  /** Se estaba escuchando música cuando se cayó la ventana anterior. */
  readonly wasListening: boolean;
  send(...messages: EngineMessage[]): void;
  start(host: EngineHost): () => void;
  readFrame(universe: number, done: (frame: number[]) => void): void;
  /** Pedido directo al proceso del motor. Solo en la app de escritorio. */
  request<T>(request: Record<string, unknown>): Promise<T>;
  dmxStatus(): EngineStatus;
  /** Para verlo al instante, sin esperar al próximo aviso del motor. */
  noteDmx(status: EngineStatus): void;
  subscribeDmx(listener: () => void): () => void;
}

export interface EngineHost {
  onChanges: (changes: EngineChanges) => void;
  /** El show completo, para un motor que arranca vacío. */
  resetMessage: () => EngineMessage;
  docMessage: () => EngineMessage;
  onCloseAsked: () => void;
}

const TICK_MS = 40;

function audioMessage(): AudioMessage | null {
  const feed = getAudioFeed();
  if (!feed) return null;
  const beats = feed.beats();
  return { levels: { ...feed.levels }, beat: beats === null ? null : { beats, bpm: feed.bpm() ?? 0 } };
}

// ---------------------------------------------------------------------
// Navegador
// ---------------------------------------------------------------------

class LocalLink implements EngineLink {
  readonly desktop = false;
  readonly resumed = null;
  readonly wasListening = false;
  private readonly show = new WasmShow();
  private rev = 0;
  private host: EngineHost | null = null;
  private hadAudio = false;

  send(...messages: EngineMessage[]): void {
    for (const message of messages) this.show.send(message, Date.now());
    this.emit();
  }

  private emit(): void {
    const changes = this.show.changes(this.rev);
    if (!changes) return;
    this.rev = changes.rev;
    this.host?.onChanges(changes);
  }

  start(host: EngineHost): () => void {
    this.host = host;
    this.send(host.resetMessage());
    const timer = setInterval(() => {
      const audio = audioMessage();
      if (audio || this.hadAudio) this.show.send({ type: "audio", audio }, Date.now());
      this.hadAudio = audio !== null;
      this.show.tick(Date.now());
      this.emit();
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      this.host = null;
    };
  }

  readFrame(universe: number, done: (frame: number[]) => void): void {
    done(this.show.frame(universe));
  }

  request<T>(): Promise<T> {
    return Promise.reject(new Error("Solo en la app de escritorio"));
  }

  dmxStatus = () => DMX_STOPPED;
  noteDmx = () => {};
  subscribeDmx = () => () => {};
}

// ---------------------------------------------------------------------
// App de escritorio
// ---------------------------------------------------------------------

/** Cada cuánto se repinta como mucho mientras algo se mueve. */
const REFRESH_MS = 33;
/** Sin cambios, el motor contesta igual al cabo de este tiempo: así sabe que
 *  la ventana no está trabada. */
const WAIT_MS = 1000;
const RETRY_MS = 400;
const AUDIO_MS = 25;

interface Attached {
  bootId: string;
  session: Session | null;
  listening: boolean;
}

interface WaitReply {
  bootId: string;
  ack: number;
  changes: EngineChanges | null;
  dmx: EngineStatus;
  focus: boolean;
}

type NativeEvent = { type: "closeAsked" };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const keyOf = (instanceId: string, channelId: string) => `${instanceId}\n${channelId}`;

let onNativeEvent: (event: NativeEvent) => void = () => {};

/** El motor contestó que no: reintentar daría lo mismo. */
class EngineError extends Error {}

function parseReply<T>(json: string): T {
  const reply = JSON.parse(json) as { ok?: T; error?: string };
  if (reply.error !== undefined) throw new EngineError(reply.error);
  return reply.ok as T;
}

async function attach(): Promise<Attached> {
  const onEvent = new Channel<NativeEvent>();
  onEvent.onmessage = (event) => onNativeEvent(event);
  return parseReply<Attached>(await invoke<string>("engine_attach", { onEvent }));
}

/** Junta lo que se pueda: arrastrar un fader no debe hacer cola. */
export function enqueue(queue: EngineMessage[], message: EngineMessage): void {
  const last = queue[queue.length - 1];
  if (message.type === "audio") {
    const index = queue.findIndex((m) => m.type === "audio");
    if (index !== -1) queue.splice(index, 1);
  } else if (last?.type === "values" && message.type === "values") {
    const values: ChannelValues = { ...last.values };
    for (const [id, channels] of Object.entries(message.values)) values[id] = { ...values[id], ...channels };
    queue[queue.length - 1] = { type: "values", values };
    return;
  } else if (last && last.type === message.type && (message.type === "doc" || message.type === "master")) {
    queue.pop();
  }
  queue.push(message);
}

class RemoteLink implements EngineLink {
  readonly desktop = true;
  readonly resumed: Session | null;
  readonly wasListening: boolean;
  private bootId: string | null;
  private rev = 0;
  private host: EngineHost | null = null;

  private queue: EngineMessage[] = [];
  // Arranca en la hora: una ventana nueva no repite números de la anterior.
  private seq = Date.now();
  private sending = false;
  /** Canales movidos acá que el motor quizá todavía no vio: lo que diga de
   *  ellos es viejo y haría saltar el fader hacia atrás. */
  private pending = new Map<string, number>();

  private dmx = DMX_STOPPED;
  private dmxListeners = new Set<() => void>();

  constructor(attached: Attached | null) {
    this.bootId = attached?.bootId ?? null;
    this.resumed = attached?.session ?? null;
    this.wasListening = attached?.listening ?? false;
  }

  send(...messages: EngineMessage[]): void {
    for (const message of messages) {
      enqueue(this.queue, message);
      if (message.type === "values") {
        for (const [id, channels] of Object.entries(message.values)) {
          for (const channelId of Object.keys(channels)) this.pending.set(keyOf(id, channelId), this.seq + 1);
        }
      }
    }
    void this.pump();
  }

  /** Un lote en vuelo a la vez: llegan en orden y nunca se acumulan. */
  private async pump(): Promise<void> {
    if (this.sending || !this.host) return;
    this.sending = true;
    while (this.queue.length > 0 && this.host) {
      const messages = this.queue;
      this.queue = [];
      this.seq += 1;
      const request = { cmd: "send", seq: this.seq, messages };
      for (;;) {
        try {
          const reply = await this.request<{ error: string | null }>(request);
          if (reply.error) console.error("El motor rechazó una orden:", reply.error);
          break;
        } catch (e) {
          if (e instanceof EngineError) {
            console.error("El motor rechazó un lote de órdenes:", e);
            break;
          }
          if (!this.host) {
            this.queue = [...messages, ...this.queue];
            break;
          }
          console.error("El motor no responde, se reintenta:", e);
          await sleep(RETRY_MS);
        }
      }
    }
    this.sending = false;
  }

  start(host: EngineHost): () => void {
    this.host = host;
    onNativeEvent = (event) => {
      if (event.type === "closeAsked") host.onCloseAsked();
    };
    // Sin bootId todavía no hubo saludo: lo hace `listen`.
    if (this.bootId !== null && !this.resumed && this.rev === 0) this.send(host.resetMessage());
    void this.pump();
    void this.listen(host);
    let hadAudio = false;
    const audioTimer = setInterval(() => {
      const audio = audioMessage();
      if (audio || hadAudio) this.send({ type: "audio", audio });
      hadAudio = audio !== null;
    }, AUDIO_MS);
    return () => {
      clearInterval(audioTimer);
      this.host = null;
    };
  }

  private async listen(host: EngineHost): Promise<void> {
    while (this.host === host) {
      const startedAt = Date.now();
      try {
        const reply = await this.call<WaitReply>(1, { cmd: "wait", since: this.rev, timeoutMs: WAIT_MS });
        if (this.host !== host) return;
        this.noteDmx(reply.dmx);
        if (reply.focus) void invoke("focus_window");
        if (reply.bootId !== this.bootId) await this.reattach(host);
        else if (reply.changes) this.applyChanges(reply.changes, reply.ack, host);
      } catch (e) {
        this.noteDmx({ ...this.dmx, state: "reconnecting", lastError: e instanceof Error ? e.message : String(e) });
        await sleep(RETRY_MS);
      }
      await sleep(Math.max(0, REFRESH_MS - (Date.now() - startedAt)));
    }
  }

  private applyChanges(changes: EngineChanges, ack: number, host: EngineHost): void {
    this.rev = changes.rev;
    for (const [key, seq] of this.pending) if (seq <= ack) this.pending.delete(key);
    if (this.pending.size === 0) return host.onChanges(changes);
    const values: ChannelValues = {};
    for (const [id, channels] of Object.entries(changes.values)) {
      values[id] = Object.fromEntries(
        Object.entries(channels).filter(([channelId]) => !this.pending.has(keyOf(id, channelId))),
      );
    }
    // Un "full" borraría del espejo justo lo que se está moviendo.
    host.onChanges({ ...changes, full: false, values });
  }

  /** Es otro motor: el anterior se cayó y su guardián lo levantó. */
  private async reattach(host: EngineHost): Promise<void> {
    const attached = await attach();
    this.bootId = attached.bootId;
    this.rev = 0;
    this.send(attached.session ? host.docMessage() : host.resetMessage());
  }

  private async call<T>(lane: 0 | 1, request: Record<string, unknown>): Promise<T> {
    return parseReply<T>(await invoke<string>("engine_call", { lane, request: JSON.stringify(request) }));
  }

  request<T>(request: Record<string, unknown>): Promise<T> {
    return this.call<T>(0, request);
  }

  readFrame(universe: number, done: (frame: number[]) => void): void {
    this.request<number[]>({ cmd: "frame", universe }).then(done, () => {});
  }

  noteDmx(next: EngineStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.dmx)) return;
    this.dmx = next;
    this.dmxListeners.forEach((listener) => listener());
  }

  dmxStatus = () => this.dmx;
  subscribeDmx = (listener: () => void) => {
    this.dmxListeners.add(listener);
    return () => void this.dmxListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------

let attached: Attached | null = null;

/** Deja el motor listo antes del primer render. */
export async function prepareEngine(): Promise<void> {
  if (!isTauri()) return fetchWasm();
  try {
    attached = await attach();
  } catch (e) {
    // La interfaz abre igual y sigue intentando.
    console.error(e);
  }
}

export function createEngineLink(): EngineLink {
  return isTauri() ? new RemoteLink(attached) : new LocalLink();
}

/** Respuesta a "¿qué hago con las luces?" al cerrar la ventana. */
export function closeWindow(keepLights: boolean): void {
  void invoke("close_window", { keepLights });
}
