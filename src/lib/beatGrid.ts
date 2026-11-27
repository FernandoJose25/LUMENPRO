/**
 * El ritmo de una canción entera, antes de que suene: cuántos golpes por
 * minuto y dónde cae el primero. Con eso, mientras la laptop la reproduce,
 * se sabe en qué golpe va sin escucharla (lib/musicPlayer.ts).
 *
 * Mira los graves (el bombo): cuánto sube su energía cada 10 ms, busca la
 * distancia que más se repite entre subidas y después afina tempo y fase
 * para que los golpes caigan justo en las subidas. Sirve para música de
 * baile, que lleva el mismo tempo toda la canción.
 */
export interface BeatGrid {
  bpm: number;
  /** Dónde cae el primer golpe, en ms desde el inicio. */
  firstBeatMs: number;
}

const HOP_MS = 10;
const MIN_BPM = 70;
const MAX_BPM = 180;
/** Entre dos tempos que encajan igual (64 y 128), el más cercano a este. */
const PREFERRED_BPM = 120;
const LOWPASS_HZ = 150;

const hopOf = (sampleRate: number) => Math.max(1, Math.round((sampleRate * HOP_MS) / 1000));

/** Subida de energía de los graves cada 10 ms. */
export function onsetEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = hopOf(sampleRate);
  const frames = Math.floor(samples.length / hop);
  const a = Math.exp((-2 * Math.PI * LOWPASS_HZ) / sampleRate);
  const energy = new Float32Array(frames);
  let y = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      y = (1 - a) * samples[i] + a * y;
      sum += y * y;
    }
    energy[f] = Math.log10(1e-10 + sum / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  return onset;
}

/** Desde dónde suena el ritmo: el primer tramo de 3 s con al menos la mitad
 *  de las subidas que tiene un tramo típico de la canción. */
function rhythmStart(onset: Float32Array, window: number): number {
  const w = Math.max(1, Math.round(window));
  const sums: number[] = [];
  let sum = 0;
  for (let i = 0; i < onset.length; i++) {
    sum += onset[i] - (i >= w ? onset[i - w] : 0);
    if (i >= w - 1) sums.push(sum);
  }
  const typical = [...sums].sort((a, b) => a - b)[Math.floor(sums.length / 2)] ?? 0;
  const first = sums.findIndex((s) => s >= typical * 0.5);
  return Math.max(0, first);
}

const prior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PREFERRED_BPM) / 0.7) ** 2);

/** Dónde está la subida más fuerte cerca de `at` (en tramos, con decimales). */
function peakNear(onset: Float32Array, at: number, radius: number): { at: number; strength: number } | null {
  const from = Math.max(1, Math.floor(at - radius));
  const to = Math.min(onset.length - 2, Math.ceil(at + radius));
  let top = -1;
  for (let i = from; i <= to; i++) if (top < 0 || onset[i] > onset[top]) top = i;
  if (top < 0 || onset[top] <= 0) return null;
  // Entre dos tramos: una parábola por el pico y sus vecinos.
  const [l, c, r] = [onset[top - 1], onset[top], onset[top + 1]];
  const shift = l - 2 * c + r === 0 ? 0 : (0.5 * (l - r)) / (l - 2 * c + r);
  return { at: top + Math.max(-0.5, Math.min(0.5, shift)), strength: c };
}

/** La recta que mejor pasa por los golpes (número de golpe → tramo). */
function line(points: { k: number; at: number }[]): { phase: number; period: number } {
  const n = points.length;
  const mk = points.reduce((s, p) => s + p.k, 0) / n;
  const mt = points.reduce((s, p) => s + p.at, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.k - mk) * (p.at - mt);
    den += (p.k - mk) ** 2;
  }
  const period = num / den;
  return { period, phase: mt - period * mk };
}

export function analyzeBeats(samples: Float32Array, sampleRate: number): BeatGrid | null {
  const onset = onsetEnvelope(samples, sampleRate);
  // El tramo dura lo que dan las muestras enteras, no 10 ms justos.
  const hopMs = (hopOf(sampleRate) * 1000) / sampleRate;
  const framesPerMin = 60_000 / hopMs;
  if (onset.length < framesPerMin / 6) return null; // menos de 10 s

  // 1. La distancia entre subidas que más se repite (autocorrelación).
  const acf = (lag: number) => {
    let sum = 0;
    for (let i = 0; i + lag < onset.length; i++) sum += onset[i] * onset[i + lag];
    return sum / (onset.length - lag);
  };
  let best = { lag: 0, score: -1 };
  for (let lag = Math.floor(framesPerMin / MAX_BPM); lag <= Math.ceil(framesPerMin / MIN_BPM); lag++) {
    const score = acf(lag) * prior(framesPerMin / lag);
    if (score > best.score) best = { lag, score };
  }
  if (best.score <= 0) return null;
  // Entre dos distancias enteras: una parábola por el pico y sus vecinos.
  const [l, c, r] = [acf(best.lag - 1), acf(best.lag), acf(best.lag + 1)];
  const bend = l - 2 * c + r;
  let period = best.lag + (bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / bend)) : 0);

  // 2. Dónde cae el golpe, mirando solo los primeros golpes desde que entra
  //    el ritmo (la intro puede no tener bombo): más adelante un tempo apenas
  //    errado ya se habría corrido.
  const start = rhythmStart(onset, framesPerMin / 20);
  let phase = start;
  let top = -1;
  for (let p = start; p < start + period; p += 0.5) {
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const at = p + k * period;
      sum += peakNear(onset, at, 1)?.strength ?? 0;
    }
    if (sum > top) [phase, top] = [p, sum];
  }

  // 3. Afinar: el golpe real más cercano a cada golpe esperado, y la recta
  //    que mejor pasa por todos. Primero con los primeros golpes, donde un
  //    tempo un poco errado todavía no se nota, y cada vez con más; sin los
  //    que se alejan (un golpe que faltó, un redoble).
  for (const reach of [16, 32, 64, 128, Infinity, Infinity]) {
    const peaks: { k: number; at: number; strength: number }[] = [];
    for (let k = 0; k < reach && phase + k * period < onset.length - 1; k++) {
      const peak = peakNear(onset, phase + k * period, period * 0.15);
      if (peak) peaks.push({ k, ...peak });
    }
    const strengths = peaks.map((p) => p.strength).sort((a, b) => a - b);
    const floor = (strengths[Math.floor(strengths.length / 2)] ?? 0) * 0.5;
    const near = peaks.filter((p) => p.strength >= floor && Math.abs(p.at - (phase + p.k * period)) < period * 0.1);
    if (near.length < 4) break;
    const fitted = line(near);
    if (!Number.isFinite(fitted.period) || fitted.period <= 0) break;
    ({ period, phase } = fitted);
  }
  phase = ((phase % period) + period) % period;
  return { bpm: Math.round((framesPerMin / period) * 100) / 100, firstBeatMs: Math.round(phase * hopMs) };
}

/** Golpes contados en ese punto de la canción, con decimales. */
export function beatsAt(grid: BeatGrid, positionMs: number): number {
  return ((positionMs - grid.firstBeatMs) * grid.bpm) / 60_000;
}
