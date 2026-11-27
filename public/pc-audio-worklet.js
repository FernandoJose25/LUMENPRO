// Corre en el hilo de audio: toca lo que manda src/lib/pcAudio.ts (el sonido
// de la PC). Si falta un pedazo suena silencio; si se atrasa, salta adelante
// para que las luces no vayan tarde.
class PcAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.port.onmessage = (e) => {
      this.queue.push(e.data);
      if (this.queue.length > 20) {
        this.queue.splice(0, this.queue.length - 4);
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length > 0) {
      const chunk = this.queue[0];
      const n = Math.min(out.length - i, chunk.length - this.offset);
      out.set(chunk.subarray(this.offset, this.offset + n), i);
      i += n;
      this.offset += n;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    out.fill(0, i);
    return true;
  }
}

registerProcessor("pc-audio", PcAudio);
