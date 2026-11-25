/** Detector de tempo: recibe qué tan fuerte "ataca" el sonido en cada instante
 *  y devuelve un reloj de golpes. No reacciona golpe a golpe sino que predice,
 *  así un bombo que no se oye o un redoble no descuadran las luces. */

const FRAME_MS = 20;
const WINDOW_MS = 6000;
const FRAMES = WINDOW_MS / FRAME_MS;
const ESTIMATE_EVERY_MS = 500;
// Con menos audio que esto el tempo sale de muy pocos golpes.
const MIN_HISTORY_MS = 3000;
const HOLD_MS = 4000;

const MIN_BPM = 70;
const MAX_BPM = 180;
// 90 y 180 suenan igual de bien para la matemática: se prefiere el tempo que
// la gente baila.
const TYPICAL_BPM = 115;
const PRIOR_WIDTH = 0.6; // octavas

const MIN_CONFIDENCE = 0.2;
/** Cuánto puede cambiar el tempo sin considerarlo otra canción. */
const SAME_TEMPO = 0.04;

export interface BeatTracker {
  push: (timeMs: number, onset: number) => void;
  bpm: () => number | null;
  /** Golpes contados hasta ese instante, con decimales; null sin tempo. */
  beats: (timeMs: number) => number | null;
}

function sampleAt(data: number[], index: number): number {
  const i = Math.floor(index);
  const a = data[i] ?? 0;
  return a + ((data[i + 1] ?? 0) - a) * (index - i);
}

function autocorrelation(data: number[], lag: number): number {
  let sum = 0;
  for (let i = 0; i < data.length - lag; i++) sum += data[i] * data[i + lag];
  return sum / (data.length - lag);
}

/** El tempo que mejor explica los ataques, y qué tan claro es (0–1). */
export function estimateTempo(onsets: number[]): { bpm: number; confidence: number } | null {
  const mean = onsets.reduce((a, b) => a + b, 0) / onsets.length;
  const data = onsets.map((v) => v - mean);
  const energy = autocorrelation(data, 0);
  if (energy < 1e-9) return null;

  const maxLag = Math.min(data.length - 1, Math.ceil((4 * 60000) / MIN_BPM / FRAME_MS) + 1);
  const correlation = Array.from({ length: maxLag + 1 }, (_, lag) => autocorrelation(data, lag));

  let best = { bpm: 0, score: 0, raw: 0 };
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const lag = 60000 / bpm / FRAME_MS;
    // Cuatro golpes seguidos: con uno solo, 20 ms de error son 5 BPM.
    let raw = 0;
    for (let k = 1; k <= 4; k++) raw += sampleAt(correlation, lag * k) / 4;
    const octaves = Math.log2(bpm / TYPICAL_BPM) / PRIOR_WIDTH;
    const score = raw * Math.exp(-0.5 * octaves * octaves);
    if (score > best.score) best = { bpm, score, raw };
  }
  return best.score > 0 ? { bpm: best.bpm, confidence: best.raw / energy } : null;
}

/** En qué punto del ciclo (0–1) caen los golpes, contando desde el inicio. */
function estimatePhase(onsets: number[], periodFrames: number): number {
  const STEPS = 32;
  let best = { phase: 0, score: -1 };
  for (let s = 0; s < STEPS; s++) {
    let score = 0;
    for (let at = (s / STEPS) * periodFrames; at < onsets.length; at += periodFrames) score += sampleAt(onsets, at);
    if (score > best.score) best = { phase: s / STEPS, score };
  }
  return best.phase;
}

const fraction = (v: number) => v - Math.floor(v);

export function createBeatTracker(): BeatTracker {
  let frames: number[] = [];
  let firstFrame = 0; // número de cuadro de frames[0]
  let lastEstimateAt = -Infinity;
  let confidentAt = -Infinity;
  let clock: { bpm: number; beats: number; at: number } | null = null;

  const beatsAt = (timeMs: number) => (clock ? clock.beats + ((timeMs - clock.at) * clock.bpm) / 60000 : 0);

  function estimate(now: number) {
    const result = estimateTempo(frames);
    if (!result || result.confidence < MIN_CONFIDENCE) {
      if (now - confidentAt > HOLD_MS) clock = null;
      return;
    }
    confidentAt = now;
    const current = clock;
    const steady = current !== null && Math.abs(result.bpm / current.bpm - 1) < SAME_TEMPO;
    const bpm = steady ? current.bpm + (result.bpm - current.bpm) * 0.3 : result.bpm;

    const period = 60000 / bpm;
    const phase = estimatePhase(frames, period / FRAME_MS);
    const target = fraction((now - firstFrame * FRAME_MS) / period - phase);
    const beats = beatsAt(now);
    // El camino corto, medio golpe como mucho, y de a poco si el tempo es el
    // mismo, para que las luces no den tirones.
    const error = fraction(target - fraction(beats) + 0.5) - 0.5;
    clock = { bpm, at: now, beats: beats + error * (steady ? 0.4 : 1) };
  }

  return {
    push(timeMs, onset) {
      const frame = Math.floor(timeMs / FRAME_MS);
      // Primer dato, o la laptop estuvo suspendida.
      if (frames.length === 0 || frame - firstFrame > frames.length + FRAMES) {
        frames = [];
        firstFrame = frame;
      }
      const index = frame - firstFrame;
      if (index < 0) return;
      // Los cuadros que el temporizador se saltó repiten el último valor.
      while (frames.length < index) frames.push(frames[frames.length - 1] ?? 0);
      frames[index] = Math.max(frames[index] ?? 0, onset);
      if (frames.length > FRAMES) {
        firstFrame += frames.length - FRAMES;
        frames = frames.slice(-FRAMES);
      }
      if (timeMs - lastEstimateAt >= ESTIMATE_EVERY_MS && frames.length * FRAME_MS >= MIN_HISTORY_MS) {
        lastEstimateAt = timeMs;
        estimate(timeMs);
      }
    },
    bpm: () => clock?.bpm ?? null,
    beats: (timeMs) => (clock ? beatsAt(timeMs) : null),
  };
}
