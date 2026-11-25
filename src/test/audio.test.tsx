import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "@/App";
import { followBand, gateDb, setAudioFeed, SILENT_BAND, type AudioFeed } from "@/lib/audioInput";
import { createBeatTracker } from "@/lib/beatTracker";
import { useEffectsEngine } from "@/lib/effectEngine";
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

describe("Effects que siguen la música", () => {
  type Store = ReturnType<typeof useFixtureStore>;
  let store: Store;
  function Engine() {
    store = useFixtureStore();
    useEffectsEngine();
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
