import { useCallback, useEffect, useRef, useState } from "react";
import { createBeatTracker, type BeatTracker } from "@/lib/beatTracker";
import { appLabel, appOf, isPcSource, openPcAudio } from "@/lib/pcAudio";
import { readSetting, writeSetting } from "@/lib/settings";

export type Band = "bass" | "mid" | "treble";

/** Hz. */
const BANDS: Record<Band, [number, number]> = { bass: [40, 160], mid: [160, 2000], treble: [2000, 10000] };
export const BAND_NAMES = Object.keys(BANDS) as Band[];

const TICK_MS = 20;
const BPM_REFRESH_MS = 500;

/** Lo que se está oyendo ahora. Vive fuera de React: cambia 50 veces por
 *  segundo y lo leen los medidores y el enlace con el motor. */
export interface AudioFeed {
  /** 0–1 por banda, ya ajustado al volumen del local. */
  levels: Record<Band, number>;
  /** Para dibujar lo que suena (Música → Pista): como `levels`, pero en
   *  silencio o en pausa es 0 de verdad (levels se ajusta hasta a un ruido). */
  loudness?: Record<Band, number>;
  /** Golpes contados, con decimales; null si no se reconoce un ritmo. */
  beats: () => number | null;
  bpm: () => number | null;
  /** Sin un ritmo reconocido (voces, ruido, una pausa) cuenta como silencio. */
  musicOnly?: () => boolean;
}

const SILENCE: Record<Band, number> = { bass: 0, mid: 0, treble: 0 };

/** Lo que se le pasa a los effects: con "Solo con música", sin ritmo no suena nada. */
export function heardLevels(feed: AudioFeed): Record<Band, number> {
  return feed.musicOnly?.() && feed.beats() === null ? { ...SILENCE } : { ...feed.levels };
}

let feed: AudioFeed | null = null;
/** La canción que suena en la laptop (lib/musicPlayer.ts): manda sobre lo
 *  que oye el micrófono. */
let songFeed: AudioFeed | null = null;
export const setSongFeed = (next: AudioFeed | null) => {
  songFeed = next;
};
/** null si no se está escuchando ni suena una canción. */
export const getAudioFeed = () => songFeed ?? feed;
export const setAudioFeed = (next: AudioFeed | null) => {
  feed = next;
};

/** Cuánto de una banda se oye de verdad: 0 con -65 dB o menos (silencio), 1 desde -55 dB. */
export const audible = (db: number) => Math.min(1, Math.max(0, (db + 65) / 10));

/** Sensibilidad 0–100 → a partir de cuántos dB se considera sonido. */
export const gateDb = (sensitivity: number) => -30 - sensitivity * 0.5;

export interface BandState {
  lo: number;
  hi: number;
  level: number;
}

export const SILENT_BAND: BandState = { lo: 0, hi: -120, level: 0 };

const DRIFT_DB_PER_S = 3;
// Con un sonido parejo hi y lo se juntan: sin un mínimo, el ruido de fondo
// llegaría al máximo.
const MIN_SPAN_DB = 12;
const RELEASE_MS = 140;

/** Pasa dB a 0–1 entre lo más bajo y lo más alto que viene sonando: así late
 *  igual con música fuerte o suave y con cualquier micrófono. Sube de golpe y
 *  baja suave. */
export function followBand(state: BandState, db: number, gate: number, dtMs: number): BandState {
  const drift = (dtMs / 1000) * DRIFT_DB_PER_S;
  const hi = Math.max(db, state.hi - drift);
  const lo = Math.min(Math.max(db, gate), state.lo + drift);
  const span = Math.max(hi - lo, MIN_SPAN_DB);
  const target = db <= gate ? 0 : Math.max(0, 1 - (hi - db) / span);
  return { lo, hi, level: Math.max(target, state.level * Math.exp(-dtMs / RELEASE_MS)) };
}

function bandDb(spectrum: Float32Array, hzPerBin: number, [from, to]: [number, number]): number {
  const first = Math.max(1, Math.round(from / hzPerBin));
  const last = Math.min(spectrum.length - 1, Math.round(to / hzPerBin));
  let power = 1e-12;
  for (let i = first; i <= last; i++) power += 10 ** (spectrum[i] / 10);
  return 10 * Math.log10(power);
}

/** Cuánto subió el sonido desde el instante anterior, sobre todo en graves. */
function onset(before: Record<Band, number>, now: Record<Band, number>, gate: number): number {
  const rise = (band: Band) => Math.max(0, Math.max(now[band], gate) - Math.max(before[band], gate));
  return rise("bass") + rise("mid") * 0.5;
}

export interface Session {
  feed: AudioFeed;
  tracker: BeatTracker;
  stop: () => void;
}

export function listen(stream: MediaStream, sensitivity: () => number, musicOnly: () => boolean): Session {
  const context = new AudioContext();
  void context.resume();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  context.createMediaStreamSource(stream).connect(analyser);

  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const hzPerBin = context.sampleRate / analyser.fftSize;
  const tracker = createBeatTracker();
  const bands: Record<Band, BandState> = { bass: SILENT_BAND, mid: SILENT_BAND, treble: SILENT_BAND };
  const audioFeed: AudioFeed = {
    levels: { bass: 0, mid: 0, treble: 0 },
    loudness: { bass: 0, mid: 0, treble: 0 },
    beats: () => tracker.beats(performance.now()),
    bpm: () => tracker.bpm(),
    musicOnly,
  };
  let before: Record<Band, number> | null = null;
  let last = performance.now();

  const timer = setInterval(() => {
    const now = performance.now();
    const gate = gateDb(sensitivity());
    analyser.getFloatFrequencyData(spectrum);
    const current = { bass: 0, mid: 0, treble: 0 };
    for (const band of BAND_NAMES) {
      current[band] = bandDb(spectrum, hzPerBin, BANDS[band]);
      bands[band] = followBand(bands[band], current[band], gate, now - last);
      audioFeed.levels[band] = bands[band].level;
      audioFeed.loudness![band] = bands[band].level * audible(current[band]);
    }
    if (before) tracker.push(now, onset(before, current, gate));
    before = current;
    last = now;
  }, TICK_MS);

  return {
    feed: audioFeed,
    tracker,
    stop: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      void context.close();
    },
  };
}

function explain(e: unknown): string {
  switch (e instanceof DOMException ? e.name : "") {
    case "NotAllowedError":
      return "Sin permiso para usar el micrófono. Actívalo en Windows: Configuración → Privacidad y seguridad → Micrófono → Permitir que las aplicaciones de escritorio accedan al micrófono.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No se encontró esa entrada de audio. Elige otra.";
    case "NotReadableError":
      return "Otro programa está usando esa entrada de audio, o se desconectó.";
    default:
      return `No se pudo escuchar: ${e instanceof Error ? e.message : String(e)}`;
  }
}

interface AudioSettings {
  deviceId: string;
  sensitivity: number;
  /** Ver AudioFeed.musicOnly. */
  musicOnly: boolean;
}

function loadSettings(): AudioSettings {
  return { deviceId: "", sensitivity: 60, musicOnly: false, ...readSetting<Partial<AudioSettings>>("audio") };
}

export interface AudioInput {
  listening: boolean;
  error: string | null;
  bpm: number | null;
  devices: { id: string; label: string }[];
  /** "" = la entrada predeterminada de Windows; PC_AUDIO = lo que suena en esta PC;
   *  appSource(exe) = lo que suena en un solo programa. */
  deviceId: string;
  sensitivity: number;
  musicOnly: boolean;
  setDeviceId: (id: string) => void;
  setSensitivity: (value: number) => void;
  setMusicOnly: (on: boolean) => void;
  start: () => Promise<void>;
  stop: () => void;
}

/** Escucha la música. Se monta una sola vez (AppShell), así sigue al cambiar
 *  de sección. `autoStart`: la ventana se reabrió sola y ya se escuchaba. */
export function useAudioInput(autoStart = false): AudioInput {
  const [settings, setSettings] = useState(loadSettings);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [devices, setDevices] = useState<AudioInput["devices"]>([]);

  const settingsRef = useRef(settings);
  const changeSettings = useCallback((patch: Partial<AudioSettings>) => {
    settingsRef.current = { ...settingsRef.current, ...patch };
    setSettings(settingsRef.current);
    writeSetting("audio", settingsRef.current);
  }, []);

  const refreshDevices = useCallback(async () => {
    const found = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    setDevices(
      found
        // "default" y "communications" repiten a otra de la lista.
        .filter((d) => d.kind === "audioinput" && d.deviceId && !["default", "communications"].includes(d.deviceId))
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Entrada ${i + 1}` })),
    );
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    const refresh = () => void refreshDevices();
    refresh();
    media.addEventListener("devicechange", refresh);
    return () => media.removeEventListener("devicechange", refresh);
  }, [refreshDevices]);

  const session = useRef<Session | null>(null);
  // Detener o volver a empezar mientras se espera el permiso invalida al
  // intento anterior.
  const attempt = useRef(0);

  const stop = useCallback(() => {
    attempt.current++;
    session.current?.stop();
    session.current = null;
    setAudioFeed(null);
    setListening(false);
    setBpm(null);
  }, []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    stop();
    const mine = attempt.current;
    setError(null);
    try {
      const { deviceId } = settingsRef.current;
      const lost = (message: string) => {
        if (mine !== attempt.current) return;
        stop();
        setError(message);
      };
      const pc =
        isPcSource(deviceId)
          ? await openPcAudio(() => {
              const app = appOf(deviceId);
              lost(
                app
                  ? `Se cerró ${appLabel(app)} o se cortó su sonido. Ábrelo y toca ▶ Escuchar otra vez.`
                  : "Se cortó el sonido de la PC (¿cambiaste de parlantes o audífonos?). Toca ▶ Escuchar otra vez.",
              );
            }, appOf(deviceId))
          : null;
      const stream =
        pc?.stream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            // Pensados para voz: con música borran el ritmo.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        }));
      if (mine !== attempt.current) {
        stream.getTracks().forEach((t) => t.stop());
        pc?.stop();
        return;
      }
      stream.getAudioTracks()[0].addEventListener("ended", () =>
        lost("Se desconectó la entrada de audio. Los effects siguen con su propia velocidad."),
      );
      const heard = listen(
        stream,
        () => settingsRef.current.sensitivity,
        () => settingsRef.current.musicOnly,
      );
      session.current = pc
        ? {
            ...heard,
            stop: () => {
              heard.stop();
              pc.stop();
            },
          }
        : heard;
      setAudioFeed(session.current.feed);
      setListening(true);
      // Los nombres de las entradas solo se ven después del permiso.
      void refreshDevices();
    } catch (e) {
      if (mine === attempt.current) setError(explain(e));
    }
  }, [refreshDevices, stop]);

  useEffect(() => {
    if (autoStart) void start();
  }, [autoStart, start]);

  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => {
      const current = session.current?.tracker.bpm() ?? null;
      setBpm(current === null ? null : Math.round(current));
    }, BPM_REFRESH_MS);
    return () => clearInterval(timer);
  }, [listening]);

  const setDeviceId = useCallback(
    (deviceId: string) => {
      changeSettings({ deviceId });
      if (session.current) void start();
    },
    [changeSettings, start],
  );
  const setSensitivity = useCallback((sensitivity: number) => changeSettings({ sensitivity }), [changeSettings]);
  const setMusicOnly = useCallback((musicOnly: boolean) => changeSettings({ musicOnly }), [changeSettings]);

  return { listening, error, bpm, devices, ...settings, setDeviceId, setSensitivity, setMusicOnly, start, stop };
}
