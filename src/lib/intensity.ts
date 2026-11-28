/**
 * Cómo suena la música ahora: calmada, normal o intensa.
 *
 * Pasado de SpectralFluxIntensityDetector de sound-to-light-osc
 * (https://github.com/scheb/sound-to-light-osc, MIT, © 2024 Christian Scheb;
 * ver THIRD_PARTY_NOTICES.md): el flujo espectral (cuánto sube cada
 * frecuencia de un instante al siguiente) del último segundo contra el de
 * todo el último minuto, con histéresis y un segundo de espera antes de
 * cambiar.
 */

/** -1 calmada, 0 normal, 1 intensa. */
export type Intensity = -1 | 0 | 1;

const FRAME_MS = 20;
const HISTORY = Math.round(60_000 / FRAME_MS);
const MIN_HISTORY = Math.round(5_000 / FRAME_MS);
const RECENT = Math.round(1_000 / FRAME_MS);
/** Cada cuánto se recalcula la mediana del minuto (cambia despacio). */
const AVERAGE_EVERY = RECENT;
const HOLD = RECENT;

const ENTER_INTENSE = 1.3;
const ENTER_CALM = 0.7;
const LEAVE_INTENSE = 1.1;
const LEAVE_CALM = 0.9;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface IntensityDetector {
  /** Un instante (cada ~20 ms): su flujo espectral; en silencio no cuenta. */
  push: (flux: number, silent: boolean) => void;
  /** null hasta oír 5 segundos de música. */
  intensity: () => Intensity | null;
}

export function createIntensityDetector(): IntensityDetector {
  const history: number[] = [];
  let average = 0;
  let sinceAverage = AVERAGE_EVERY;
  let current: Intensity | null = null;
  let pending: Intensity | null = null;
  let held = 0;

  return {
    push(flux, silent) {
      // En silencio (una pausa) no se cuenta: no baja el promedio.
      if (silent) return;
      history.push(flux);
      if (history.length > HISTORY) history.shift();
      if (history.length < MIN_HISTORY) return;
      if (++sinceAverage >= AVERAGE_EVERY) {
        average = median(history);
        sinceAverage = 0;
      }
      const recent = median(history.slice(-RECENT));
      let target: Intensity;
      if (current === 1) target = recent < ENTER_CALM * average ? -1 : recent < LEAVE_INTENSE * average ? 0 : 1;
      else if (current === -1) target = recent > LEAVE_CALM * average ? 0 : -1;
      else target = recent > ENTER_INTENSE * average ? 1 : recent < ENTER_CALM * average ? -1 : 0;

      if (target === current) {
        pending = null;
        held = 0;
      } else if (target !== pending) {
        pending = target;
        held = 0;
      } else if (++held > HOLD) {
        current = target;
        pending = null;
        held = 0;
      }
    },
    intensity: () => current,
  };
}

/** Flujo espectral: cuánto subió cada frecuencia desde el instante anterior
 *  (en amplitud, no en dB, como el original). `before` se actualiza. */
export function spectralFlux(spectrumDb: Float32Array, before: Float32Array, bins: number): number {
  let flux = 0;
  for (let i = 1; i < bins; i++) {
    const amplitude = 10 ** (spectrumDb[i] / 20);
    flux += Math.max(0, amplitude - before[i]);
    before[i] = amplitude;
  }
  return flux;
}
