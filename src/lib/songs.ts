import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Song } from "@/types/timeline";

/**
 * Las canciones de las líneas de tiempo. En la app de escritorio se copian a
 * la carpeta del programa (src-tauri/src/show.rs), junto al show; en el
 * navegador duran lo que la pestaña.
 */
const inMemory = new Map<string, Blob>();
const urls = new Map<string, Promise<string>>();
const shapes = new Map<string, Promise<SongShape>>();

const TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg" };

function extOf(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) : "";
  return ext || "mp3";
}

export async function saveSong(file: File): Promise<Song> {
  const ext = extOf(file.name);
  if (!isTauri()) {
    const saved = `cancion-${Date.now()}.${ext}`;
    inMemory.set(saved, file);
    return { file: saved, name: file.name };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const saved = await invoke<string>("save_song", bytes, { headers: { "x-ext": ext } });
  return { file: saved, name: file.name };
}

/** Para el <audio>. Rechaza si la canción ya no está. */
export function songUrl(song: Song): Promise<string> {
  let url = urls.get(song.file);
  if (!url) {
    url = (async () => {
      const type = TYPES[extOf(song.file)] ?? "";
      const blob = isTauri()
        ? new Blob([await invoke<ArrayBuffer>("read_song", { file: song.file })], { type })
        : inMemory.get(song.file);
      if (!blob) throw new Error("No encuentro la canción: vuelve a cargarla.");
      return URL.createObjectURL(blob);
    })();
    url.catch(() => urls.delete(song.file));
    urls.set(song.file, url);
  }
  return url;
}

export interface SongShape {
  durationMs: number;
  /** Lo fuerte que suena cada tramo, 0–1, de principio a fin. */
  peaks: number[];
}

const PEAKS = 2000;

/** Para dibujar la forma de la canción. */
export function songShape(song: Song): Promise<SongShape> {
  let shape = shapes.get(song.file);
  if (!shape) {
    shape = (async () => {
      const data = await (await fetch(await songUrl(song))).arrayBuffer();
      const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, n) => buffer.getChannelData(n));
      const size = Math.max(1, Math.floor(buffer.length / PEAKS));
      const peaks: number[] = [];
      for (let start = 0; start < buffer.length; start += size) {
        let peak = 0;
        for (const samples of channels) {
          for (let i = start; i < Math.min(start + size, buffer.length); i += 4) peak = Math.max(peak, Math.abs(samples[i]));
        }
        peaks.push(Math.min(1, peak));
      }
      return { durationMs: Math.round(buffer.duration * 1000), peaks };
    })();
    shape.catch(() => shapes.delete(song.file));
    shapes.set(song.file, shape);
  }
  return shape;
}
