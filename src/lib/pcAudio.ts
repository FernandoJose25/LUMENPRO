import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** `deviceId` de "Lo que suena en esta PC" (todo) en Audio Reactive. */
export const PC_AUDIO = "lumen:pc";
const APP = "lumen:app:";

/** `deviceId` de "Solo …": lo que suena en un programa (su exe, como "brave.exe"). */
export const appSource = (exe: string) => `${APP}${exe.toLowerCase()}`;
export const BRAVE_ONLY = appSource("brave.exe");

/** Si el deviceId copia el sonido de la PC (todo o un programa) en vez de un micrófono. */
export const isPcSource = (deviceId: string) => deviceId === PC_AUDIO || deviceId.startsWith(APP);

/** El exe del programa de un deviceId "Solo …", o null. */
export const appOf = (deviceId: string) => (deviceId.startsWith(APP) ? deviceId.slice(APP.length) : null);

const NAMES: Record<string, string> = {
  "brave.exe": "Brave",
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
  "opera.exe": "Opera",
  "spotify.exe": "Spotify",
  "virtualdj.exe": "VirtualDJ",
  "vlc.exe": "VLC",
};

/** "brave.exe" → "Brave"; "valorant-win64-shipping.exe" → "Valorant". */
export function appLabel(exe: string): string {
  const base = exe
    .replace(/\.exe$/i, "")
    .replace(/[-_](win64|win32|x64|x86)([-_]shipping)?$/i, "")
    .replace(/[-_]shipping$/i, "");
  return NAMES[exe.toLowerCase()] ?? base.charAt(0).toUpperCase() + base.slice(1);
}

/** Solo la app de escritorio puede copiar el sonido de Windows. */
export const pcAudioAvailable = () => isTauri();

/** Los programas que tienen sonido ahora (y Brave si está instalado). */
export const listPcApps = () =>
  invoke<string[] | null>("pc_audio_apps").then(
    (apps) => (Array.isArray(apps) ? apps : []),
    () => [] as string[],
  );

export interface PcAudio {
  stream: MediaStream;
  stop: () => void;
}

/** Lo que sale por los parlantes de esta PC (Spotify, YouTube, VirtualDJ…),
 *  o solo lo de un programa (`app`, como "brave.exe"), sin cable ni
 *  micrófono: lo copia src-tauri/src/pc_audio.rs y aquí se vuelve un
 *  MediaStream, para escucharlo igual que a un micrófono. */
export async function openPcAudio(onEnded: () => void, app: string | null = null): Promise<PcAudio> {
  let player: AudioWorkletNode | null = null;
  const onAudio = new Channel<ArrayBuffer | "ended">();
  onAudio.onmessage = (msg) => {
    if (msg === "ended") onEnded();
    else player?.port.postMessage(new Float32Array(msg), [msg]);
  };
  const sampleRate = await invoke<number>("pc_audio_start", { onAudio, app });
  const context = new AudioContext({ sampleRate });
  const stop = () => {
    onAudio.onmessage = () => {};
    void invoke("pc_audio_stop");
    void context.close();
  };
  try {
    await context.audioWorklet.addModule("/pc-audio-worklet.js");
    player = new AudioWorkletNode(context, "pc-audio", { numberOfInputs: 0, outputChannelCount: [1] });
    const out = context.createMediaStreamDestination();
    player.connect(out);
    void context.resume();
    return { stream: out.stream, stop };
  } catch (e) {
    stop();
    throw e;
  }
}
