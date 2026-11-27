import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "@/App";
import { audible, followBand, followHits, gateDb, NO_HITS, setAudioFeed, SILENT_BAND, type AudioFeed } from "@/lib/audioInput";
import { createBeatTracker } from "@/lib/beatTracker";
import { FixtureStoreProvider, useFixtureStore } from "@/lib/fixtureStore";
import type { Effect } from "@/types/effect";

/** Números repetibles: con Math.random el test fallaría cada tanto. */
function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/** Alimenta el detector como lo haría el micrófono: cada ~20 ms, con
 *  temblor, ruido de fondo y golpes en los instantes dados. */
function play(tracker: ReturnType<typeof createBeatTracker>, hits: number[], fromMs: number, toMs: number, noise = 1) {
  const rand = random(7);
  let t = fromMs;
  while (t < toMs) {
    const next = t + 16 + rand() * 8;
    const hit = hits.some((h) => h >= t && h < next);
    tracker.push(next, rand() * noise + (hit ? 12 : 0));
    t = next;
  }
}

const everyBeat = (bpm: number, from: number, to: number) => {
  const period = 60000 / bpm;
  return Array.from({ length: Math.floor((to - from) / period) }, (_, i) => from + i * period);
};

/** Qué tan lejos está el reloj del golpe real, en fracción de golpe. */
function phaseError(beats: number) {
  return Math.abs(beats - Math.round(beats));
}

describe("Detector de ritmo", () => {
  it.each([75, 90, 100, 120, 128, 140])("reconoce %i BPM y cae en el golpe", (bpm) => {
    const tracker = createBeatTracker();
    const hits = everyBeat(bpm, 300, 20000);
    play(tracker, hits, 0, 20000);
    expect(Math.abs(tracker.bpm()! - bpm)).toBeLessThan(1.5);
    expect(phaseError(tracker.beats(hits[hits.length - 1])!)).toBeLessThan(0.12);
  });

  it("reguetón: el bombo y el contratiempo no lo confunden", () => {
    const tracker = createBeatTracker();
    const beat = 60000 / 94;
    const hits = everyBeat(94, 0, 20000).flatMap((t, i) => (i % 2 === 0 ? [t, t + beat * 0.75] : [t, t + beat * 0.5]));
    play(tracker, hits, 0, 20000);
    expect(Math.abs(tracker.bpm()! - 94)).toBeLessThan(2);
  });

  it("aguanta golpes que no se oyen", () => {
    const tracker = createBeatTracker();
    play(tracker, everyBeat(120, 0, 20000).filter((_, i) => i % 5 !== 3), 0, 20000);
    expect(Math.abs(tracker.bpm()! - 120)).toBeLessThan(1.5);
  });

  it("con voz o ruido no inventa un ritmo", () => {
    const tracker = createBeatTracker();
    const rand = random(3);
    play(tracker, Array.from({ length: 50 }, () => rand() * 20000), 0, 20000, 6);
    expect(tracker.bpm()).toBeNull();
    expect(tracker.beats(20000)).toBeNull();
  });

  it("cambia de canción y suelta el ritmo cuando la música para", () => {
    const tracker = createBeatTracker();
    play(tracker, everyBeat(100, 0, 15000), 0, 15000);
    expect(Math.abs(tracker.bpm()! - 100)).toBeLessThan(1.5);
    play(tracker, everyBeat(128, 15000, 35000), 15000, 35000);
    expect(Math.abs(tracker.bpm()! - 128)).toBeLessThan(1.5);
    play(tracker, [], 35000, 55000);
    expect(tracker.bpm()).toBeNull();
  });

  it("con el ritmo estable el reloj nunca retrocede ni da saltos", () => {
    const tracker = createBeatTracker();
    const hits = everyBeat(126, 0, 30000);
    play(tracker, hits, 0, 10000);
    let last = tracker.beats(10000)!;
    for (let t = 10000; t < 30000; t += 100) {
      play(tracker, hits, t, t + 100);
      const now = tracker.beats(t + 100)!;
      expect(now - last).toBeGreaterThan(0);
      expect(now - last).toBeLessThan(0.5);
      last = now;
    }
  });
});

describe("Nivel por banda", () => {
  const gate = gateDb(60);
  /** Música con bombo: entre `low` y `low + 20` dB. */
  function listen(low: number) {
    let state = SILENT_BAND;
    const levels: number[] = [];
    for (let i = 0; i < 400; i++) {
      state = followBand(state, i % 25 < 4 ? low + 20 : low, gate, 20);
      if (i > 200) levels.push(state.level);
    }
    return levels;
  }

  it("late igual con música fuerte que suave", () => {
    for (const low of [-50, -30]) {
      const levels = listen(low);
      expect(Math.max(...levels)).toBeGreaterThan(0.95);
      expect(Math.min(...levels)).toBeLessThan(0.15);
    }
  });

  it("por debajo del umbral es silencio, y el ruido parejo no llega al máximo", () => {
    expect(Math.max(...listen(-110))).toBe(0);
    let state = SILENT_BAND;
    const rand = random(1);
    for (let i = 0; i < 500; i++) state = followBand(state, -100 + rand() * 4, gate, 20);
    expect(state.level).toBe(0);
  });
});

describe("Golpes por banda", () => {
  const RATE = 48000;
  const N = 2048;

  /** Potencia de cada frecuencia, como la saca el AnalyserNode (ventana Blackman). */
  function spectrum(samples: Float64Array, end: number): Float64Array {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N);
      re[i] = (samples[end - N + i] ?? 0) * w;
    }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
    }
    for (let len = 2; len <= N; len <<= 1) {
      const a = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const [c, s] = [Math.cos(a * k), Math.sin(a * k)];
          const [p, q] = [i + k, i + k + len / 2];
          const tr = re[q] * c - im[q] * s;
          const ti = re[q] * s + im[q] * c;
          [re[q], im[q]] = [re[p] - tr, im[p] - ti];
          [re[p], im[p]] = [re[p] + tr, im[p] + ti];
        }
      }
    }
    return Float64Array.from({ length: N / 2 }, (_, k) => (re[k] ** 2 + im[k] ** 2) / N ** 2);
  }

  const bandDb = (power: Float64Array, [from, to]: [number, number]) => {
    let sum = 1e-12;
    for (let k = Math.round((from * N) / RATE); k <= Math.round((to * N) / RATE); k++) sum += power[k];
    return 10 * Math.log10(sum);
  };

  /**
   * Reguetón a 95 BPM: bombo en cada golpe, caja en el contratiempo y un
   * bajo 808 que suena todo el rato. Al final, un redoble de bombos rápidos y
   * después solo el bajo.
   */
  /** Un bombo de verdad: baja de 150 a 50 Hz en unos 30 ms. O uno en 55 Hz
   *  justo, que con el bajo en 50 Hz se refuerza y se cancela (late). */
  const KICKS = {
    real: (d: number) => 0.9 * Math.exp(-d / 0.08) * Math.sin(2 * Math.PI * (50 * d + 100 * 0.03 * (1 - Math.exp(-d / 0.03)))),
    "pegado al bajo": (d: number) => 0.9 * Math.exp(-d / 0.08) * Math.sin(2 * Math.PI * 55 * d),
  };

  function dembow(kick: (d: number) => number) {
    const beat = 60 / 95;
    const kicks: number[] = [];
    const snares: number[] = [];
    for (let b = 0; b < 12; b++) {
      kicks.push(b * beat);
      snares.push((b + (b % 2 === 0 ? 0.75 : 0.5)) * beat);
    }
    for (let i = 0; i < 8; i++) kicks.push((12 + i / 4) * beat);
    const seconds = 14 * beat + 2.5;
    const samples = new Float64Array(Math.round(seconds * RATE));
    const rand = random(5);
    for (let n = 0; n < samples.length; n++) {
      const t = n / RATE;
      let x = 0.4 * Math.sin(2 * Math.PI * 50 * t);
      for (const k of kicks) {
        const d = t - k;
        if (d >= 0 && d < 0.3) x += kick(d);
      }
      for (const s of snares) {
        const d = t - s;
        if (d >= 0 && d < 0.2) x += 0.35 * Math.exp(-d / 0.05) * (rand() * 2 - 1);
      }
      samples[n] = x;
    }
    return { samples, kicks, snares };
  }

  it.each(Object.keys(KICKS) as (keyof typeof KICKS)[])("cuenta cada bombo del reguetón (%s), también el redoble, y el bajo parejo no deja la luz prendida", (name) => {
    const { samples, kicks } = dembow(KICKS[name]);
    const gate = gateDb(60);
    let bass = NO_HITS;
    let mid = NO_HITS;
    const punches: { t: number; punch: number }[] = [];
    const hitTimes: number[] = [];
    for (let end = N, t = 0; end <= samples.length; end += 960, t += 20) {
      const power = spectrum(samples, end);
      const before = bass.target;
      bass = followHits(bass, bandDb(power, [40, 160]), gate, t, 20, "bass");
      mid = followHits(mid, bandDb(power, [160, 2000]), gate, t, 20, "mid");
      if (bass.target > before) hitTimes.push(end / RATE);
      punches.push({ t: end / RATE, punch: bass.punch });
    }
    // Ninguno inventado: cada uno cae en un bombo (el análisis mira los últimos 43 ms).
    for (const t of hitTimes) expect(kicks.some((k) => t - k >= 0 && t - k < 0.12), `golpe en ${t}`).toBe(true);
    // El de verdad, todos; el que se cancela con el bajo, casi todos.
    expect(hitTimes.length).toBeGreaterThanOrEqual(name === "real" ? kicks.length : kicks.length - 3);
    // Entre golpes y con solo el bajo, a oscuras.
    const quiet = punches.filter((p) => hitTimes.every((h) => p.t - h > 0.25 || p.t < h));
    expect(Math.max(...quiet.map((p) => p.punch))).toBeLessThan(0.1);
    expect(punches[punches.length - 1].punch).toBeLessThan(0.001);
    // La caja suena en los medios.
    expect(mid.target).toBeGreaterThanOrEqual(12);
    // El contador llega al golpe en un instante.
    expect(Math.abs(bass.count - bass.target)).toBeLessThan(0.01);
    expect(bass.target).toBe(hitTimes.length);
  });

  it("sin sonido se apaga al instante", () => {
    const gate = gateDb(60);
    let state = followHits(NO_HITS, -20, gate, 0, 20, "bass");
    expect(state.punch).toBe(1);
    state = followHits(state, -120, gate, 20, 20, "bass");
    expect(state.punch).toBe(0);
  });
});

describe("Effects que siguen la música", () => {
  type Store = ReturnType<typeof useFixtureStore>;
  let store: Store;
  function Engine() {
    store = useFixtureStore();
      return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    render(
      <FixtureStoreProvider>
        <Engine />
      </FixtureStoreProvider>,
    );
  });
  afterEach(() => {
    setAudioFeed(null);
    vi.useRealTimers();
  });

  const feed = (levels: Partial<AudioFeed["levels"]>, beats: number | null): AudioFeed => ({
    levels: { bass: 0, mid: 0, treble: 0, ...levels },
    beats: () => beats,
    bpm: () => null,
  });

  function run(patch: Partial<Effect>) {
    let id = "";
    let groupId = "";
    act(() => void (groupId = store.addGroup("PAR").id));
    act(() => store.setInstanceGroup(store.instances[2].id, groupId));
    act(() => void (id = store.addEffect("fx").id));
    act(() => store.updateEffect(id, { groupId, channelType: "DIMMER", ...patch }));
    act(() => store.startEffect(id));
  }
  const dimmer = () => {
    act(() => vi.advanceTimersByTime(40));
    return Object.values(store.liveValues[store.instances[2].id])[0];
  };

  it("graves: del mínimo al máximo según cuánto suena", () => {
    run({ source: "bass", min: 50, max: 250 });
    setAudioFeed(feed({ bass: 0 }, null));
    expect(dimmer()).toBe(50);
    setAudioFeed(feed({ bass: 0.5 }, null));
    expect(dimmer()).toBe(150);
    setAudioFeed(feed({ bass: 1 }, null));
    expect(dimmer()).toBe(250);
  });

  it("solo con música: sin ritmo reconocido, los graves no prenden nada", () => {
    run({ source: "bass", min: 0, max: 250 });
    setAudioFeed({ ...feed({ bass: 1 }, null), musicOnly: () => true });
    expect(dimmer()).toBe(0);
    setAudioFeed({ ...feed({ bass: 1 }, 3), musicOnly: () => true });
    expect(dimmer()).toBe(250);
  });

  it("sin escuchar, los graves se quedan en su mínimo", () => {
    run({ source: "bass", min: 0, max: 250 });
    setAudioFeed(null);
    expect(dimmer()).toBe(0);
  });

  it("ritmo: la onda avanza con los golpes y no con el reloj", () => {
    run({ source: "beat", waveform: "sawtooth", min: 0, max: 200, beatsPerCycle: 4 });
    setAudioFeed(feed({}, 8));
    expect(dimmer()).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(dimmer()).toBe(0);
    setAudioFeed(feed({}, 11));
    expect(dimmer()).toBe(150);
  });

  it("golpe: arriba en el golpe y baja hasta el siguiente", () => {
    run({ source: "beat", waveform: "pulse", min: 0, max: 200 });
    setAudioFeed(feed({}, 4));
    expect(dimmer()).toBe(200);
    setAudioFeed(feed({}, 4.5));
    expect(dimmer()).toBe(50);
  });

  it.each([
    ["sin escuchar", null],
    ["sin ritmo reconocido", feed({}, null)],
  ])("%s sigue con su velocidad propia", (_, audio) => {
    run({ source: "beat", waveform: "sawtooth", speedCpm: 60, min: 0, max: 100 });
    setAudioFeed(audio);
    const first = dimmer();
    act(() => vi.advanceTimersByTime(400));
    expect(dimmer()).toBeGreaterThan(first);
  });

  it("un show guardado antes de la música abre con tiempo fijo", () => {
    act(() =>
      store.importShow(
        JSON.stringify({
          definitions: [],
          instances: [],
          effects: [{ id: "e", name: "viejo", groupId: null, channelType: "DIMMER", waveform: "sine", speedCpm: 20, min: 0, max: 255, phaseOffsetDeg: 0 }],
        }),
      ),
    );
    expect(store.effects[0]).toMatchObject({ source: "clock", beatsPerCycle: 1 });
  });
});

describe("Pantalla Audio Reactive", () => {
  it("sin permiso explica dónde darlo y no queda escuchando", async () => {
    localStorage.clear();
    const media = new EventTarget() as unknown as MediaDevices;
    Object.assign(media, {
      enumerateDevices: async () => [],
      getUserMedia: async () => {
        throw new DOMException("no", "NotAllowedError");
      },
    });
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { mediaDevices: media }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Audio Reactive" }));
    fireEvent.click(screen.getByRole("button", { name: "▶ Escuchar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Privacidad y seguridad → Micrófono");
    expect(screen.getByRole("button", { name: "▶ Escuchar" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe("Pista de Música", () => {
  it("en silencio o en pausa no dibuja nada, aunque levels se ajuste al ruido", () => {
    expect(audible(-120)).toBe(0);
    expect(audible(-65)).toBe(0);
    expect(audible(-60)).toBeCloseTo(0.5);
    expect(audible(-20)).toBe(1);
  });
});
