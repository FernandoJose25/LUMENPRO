import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** `deviceId` de "Lo que suena en esta PC" en Audio Reactive. */
export const PC_AUDIO = "lumen:pc";

/** Solo la app de escritorio puede copiar el sonido de Windows. */
export const pcAudioAvailable = () => isTauri();

export interface PcAudio {
  stream: MediaStream;
  stop: () => void;
}

/** Lo que sale por los parlantes de esta PC (Spotify, YouTube, VirtualDJ…),
 *  sin cable ni micrófono: lo copia src-tauri/src/pc_audio.rs y aquí se
 *  vuelve un MediaStream, para escucharlo igual que a un micrófono. */
export async function openPcAudio(onEnded: () => void): Promise<PcAudio> {
  let player: AudioWorkletNode | null = null;
  const onAudio = new Channel<ArrayBuffer | "ended">();
  onAudio.onmessage = (msg) => {
    if (msg === "ended") onEnded();
    else player?.port.postMessage(new Float32Array(msg), [msg]);
  };
  const sampleRate = await invoke<number>("pc_audio_start", { onAudio });
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
