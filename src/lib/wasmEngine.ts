import type { EngineChanges, EngineMessage } from "@/types/engine";

/** El motor del show (show-engine/) compilado a WASM: ver show-engine/src/wasm.rs. */
interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  show_new(): number;
  show_send(show: number, ptr: number, len: number, now: number): bigint;
  show_tick(show: number, now: number): void;
  show_changes(show: number, since: number): bigint;
  show_frame(show: number, universe: number): number;
}

const CHANNELS = 512;

let wasm: Exports | null = null;

export function loadWasm(bytes: BufferSource): void {
  wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as unknown as Exports;
}

export async function fetchWasm(): Promise<void> {
  if (wasm) return;
  const { default: url } = await import("@/engine/show_engine.wasm?url");
  loadWasm(await (await fetch(url)).arrayBuffer());
}

function exportsOrThrow(): Exports {
  if (!wasm) throw new Error("El motor del show no está cargado");
  return wasm;
}

export class WasmShow {
  private readonly w = exportsOrThrow();
  private readonly show = this.w.show_new();

  /** Lanza si el motor rechaza la orden. */
  send(message: EngineMessage, now: number): void {
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    const ptr = this.w.alloc(bytes.length);
    new Uint8Array(this.w.memory.buffer).set(bytes, ptr);
    const error = this.text(this.w.show_send(this.show, ptr, bytes.length, now));
    this.w.dealloc(ptr, bytes.length);
    if (error) throw new Error(error);
  }

  tick(now: number): void {
    this.w.show_tick(this.show, now);
  }

  /** null si no cambió nada después de `since`. */
  changes(since: number): EngineChanges | null {
    const json = this.text(this.w.show_changes(this.show, since));
    return json ? (JSON.parse(json) as EngineChanges) : null;
  }

  frame(universe: number): number[] {
    const ptr = this.w.show_frame(this.show, universe);
    const frame = Array.from(new Uint8Array(this.w.memory.buffer, ptr, CHANNELS));
    this.w.dealloc(ptr, CHANNELS);
    return frame;
  }

  private text(packed: bigint): string {
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    const text = new TextDecoder().decode(new Uint8Array(this.w.memory.buffer, ptr, len));
    this.w.dealloc(ptr, len);
    return text;
  }
}
