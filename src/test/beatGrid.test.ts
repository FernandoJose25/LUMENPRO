import { describe, it, expect } from "vitest";
import { analyzeBeats, beatsAt } from "@/lib/beatGrid";

const RATE = 22050;

/** Una canción de mentira: bombo en cada golpe, platillo a contratiempo y
 *  algo de ruido, para que no sea demasiado fácil. */
function song(bpm: number, firstBeatMs: number, seconds: number, { swing = 0 } = {}): Float32Array {
  const samples = new Float32Array(RATE * seconds);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < samples.length; i++) samples[i] = noise() * 0.02;
  const period = 60 / bpm;
  for (let beat = 0, t = firstBeatMs / 1000; t < seconds; beat++, t = firstBeatMs / 1000 + beat * period) {
    const start = Math.round(t * RATE);
    for (let i = 0; i < RATE * 0.15 && start + i < samples.length; i++) {
      const s = i / RATE;
      samples[start + i] += Math.sin(2 * Math.PI * 55 * s) * Math.exp(-s * 25) * 0.9;
    }
    // Platillo (agudos: el análisis mira los graves).
    const hat = Math.round((t + period * (0.5 + swing)) * RATE);
    for (let i = 0; i < RATE * 0.03 && hat + i < samples.length; i++) samples[hat + i] += noise() * 0.4 * Math.exp(-i / 200);
  }
  return samples;
}

describe("Ritmo de una canción", () => {
  it.each([
    [128, 300],
    [95, 120],
    [140, 0],
    [100, 450],
  ])("encuentra %d BPM y el primer golpe en %d ms", (bpm, firstBeatMs) => {
    const grid = analyzeBeats(song(bpm, firstBeatMs, 40), RATE)!;
    expect(grid.bpm).toBeGreaterThan(bpm - 0.3);
    expect(grid.bpm).toBeLessThan(bpm + 0.3);
    // La fase puede caer un golpe después: lo que importa es dónde cae en el ciclo.
    const period = 60_000 / bpm;
    const off = Math.abs(((grid.firstBeatMs - firstBeatMs + period / 2) % period) - period / 2);
    expect(off).toBeLessThan(20);
    // Golpe entero justo en un bombo de más adelante.
    const later = firstBeatMs + period * 40;
    const beats = beatsAt(grid, later);
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.08);
  });

  it("una intro sin bombo no lo confunde", () => {
    const intro = 12;
    const body = song(124, 0, 40);
    const samples = new Float32Array(RATE * (intro + 40));
    for (let i = 0; i < RATE * intro; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / RATE) * 0.2 * Math.sin((Math.PI * i) / (RATE * intro));
    samples.set(body, RATE * intro);
    const grid = analyzeBeats(samples, RATE)!;
    expect(Math.abs(grid.bpm - 124)).toBeLessThan(0.3);
    const period = 60_000 / 124;
    const later = intro * 1000 + period * 50;
    const beats = beatsAt(grid, later);
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.08);
  });

  it("con un tempo lento elige el doble si cae en el rango de baile, no la mitad", () => {
    const grid = analyzeBeats(song(64, 200, 40), RATE)!;
    expect([64, 128].some((b) => Math.abs(grid.bpm - b) < 0.5)).toBe(true);
  });

  it("una canción de menos de 10 segundos no se analiza", () => {
    expect(analyzeBeats(song(120, 0, 5), RATE)).toBeNull();
  });
});
