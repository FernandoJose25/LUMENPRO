import { useCallback, useEffect, useRef, useState } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { BAND_NAMES, listen, setSongFeed, type AudioFeed, type Band, type Session } from "@/lib/audioInput";
import { beatsAt, type BeatGrid } from "@/lib/beatGrid";
import { songUrl } from "@/lib/songs";
import { songOutput } from "@/lib/timelineAudio";
import type { PlaylistSong } from "@/types/music";

/** Cada cuánto se refresca la barra de la canción. */
const POSITION_MS = 250;
/** Sensibilidad fija: la canción llega limpia, sin el ruido del local. */
const SENSITIVITY = 60;

type SinkAudio = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
  captureStream?: () => MediaStream;
};

export interface MusicPlayer {
  songId: string | null;
  playing: boolean;
  positionMs: number;
  /** El tempo de la que suena, si se conoce. */
  bpm: number | null;
  error: string | null;
  play: (songId: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
}

/** 1 en cada golpe y se apaga hasta el siguiente, como un bombo. */
const pulse = (beats: number) => Math.exp(-6 * (beats - Math.floor(beats)));

/**
 * Lo que oyen las luces mientras suena una canción de la laptop: el golpe
 * sale del análisis (exacto desde el primer compás) y los graves, medios y
 * agudos de la canción misma, sin micrófono.
 */
function songFeed(audio: SinkAudio, grid: BeatGrid | null): { feed: AudioFeed; stop: () => void } {
  const beats = () => (grid ? beatsAt(grid, audio.currentTime * 1000) : null);
  let session: Session | null = null;
  try {
    const stream = audio.captureStream?.();
    if (stream && stream.getAudioTracks().length > 0) session = listen(stream, () => SENSITIVITY, () => false);
  } catch {
    session = null;
  }
  const heard = session;
  const feed: AudioFeed = {
    get levels(): Record<Band, number> {
      if (heard) return heard.feed.levels;
      // Sin poder oírla, el golpe del análisis hace de bombo.
      const b = beats();
      const p = b === null || b < 0 ? 0 : pulse(b);
      return Object.fromEntries(BAND_NAMES.map((band) => [band, p])) as Record<Band, number>;
    },
    get loudness(): Record<Band, number> {
      return heard?.feed.loudness ?? this.levels;
    },
    get hits(): Record<Band, number> | undefined {
      if (heard) return heard.feed.hits;
      const b = beats();
      return b === null || b < 0 ? undefined : (Object.fromEntries(BAND_NAMES.map((band) => [band, b])) as Record<Band, number>);
    },
    beats: () => {
      const b = beats();
      if (b !== null) return Math.max(0, b);
      return heard ? heard.feed.beats() : null;
    },
    bpm: () => grid?.bpm ?? heard?.feed.bpm() ?? null,
    musicOnly: () => false,
    intensity: () => heard?.feed.intensity?.() ?? null,
  };
  return { feed, stop: () => heard?.stop() };
}

/**
 * La música de la hora loca, desde la laptop por el cable a la consola. Se
 * monta una sola vez (AppShell): sigue sonando al cambiar de sección y pasa
 * sola a la siguiente. Si arranca una línea de tiempo (el vals), se pausa.
 */
export function useMusicPlayer(): MusicPlayer {
  const { playlist, timeline } = useFixtureStore();
  const [songId, setSongId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<SinkAudio | null>(null);
  const audio = () => (audioRef.current ??= new Audio() as SinkAudio);
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const currentRef = useRef<string | null>(null);

  const play = useCallback(async (id: string) => {
    const song = playlistRef.current.find((s) => s.id === id);
    if (!song) return;
    const element = audio();
    try {
      const url = await songUrl(song);
      if (currentRef.current !== id) {
        element.src = url;
        element.currentTime = 0;
        const output = songOutput();
        if (output) element.setSinkId?.(output).catch(() => {});
      }
      currentRef.current = id;
      setSongId(id);
      await element.play();
      setPlaying(true);
      setError(null);
    } catch {
      setPlaying(false);
      setError(`No suena «${song.name}». Si se borró, quítala y vuelve a agregarla.`);
    }
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const step = useCallback(
    (direction: -1 | 1) => {
      const list = playlistRef.current;
      const index = list.findIndex((s) => s.id === currentRef.current);
      const target = list[index + direction] ?? (index < 0 ? list[0] : undefined);
      if (target) void play(target.id);
      else pause();
    },
    [play, pause],
  );

  const toggle = useCallback(() => {
    if (playing) return pause();
    const id = currentRef.current ?? playlistRef.current[0]?.id;
    if (id) void play(id);
  }, [playing, play, pause]);

  // Al terminar, la siguiente.
  useEffect(() => {
    const element = audio();
    const onEnded = () => step(1);
    element.addEventListener("ended", onEnded);
    return () => element.removeEventListener("ended", onEnded);
  }, [step]);

  // El vals manda: si arranca una línea de tiempo, la música se pausa.
  const timelinePlaying = timeline !== null && timeline.pausedAt === null;
  useEffect(() => {
    if (timelinePlaying) pause();
  }, [timelinePlaying, pause]);

  // Una canción que se quitó de la lista deja de sonar.
  useEffect(() => {
    if (songId && !playlist.some((s) => s.id === songId)) {
      pause();
      currentRef.current = null;
      setSongId(null);
    }
  }, [playlist, songId, pause]);

  const song: PlaylistSong | undefined = playlist.find((s) => s.id === songId);
  const grid = song && song.bpm ? { bpm: song.bpm, firstBeatMs: song.firstBeatMs } : null;
  const gridKey = grid ? `${grid.bpm}:${grid.firstBeatMs}` : "";

  // Mientras suena, las luces la oyen.
  useEffect(() => {
    if (!playing) return;
    const element = audio();
    const heard = songFeed(element, gridKey ? grid : null);
    setSongFeed(heard.feed);
    const timer = setInterval(() => setPositionMs(element.currentTime * 1000), POSITION_MS);
    return () => {
      clearInterval(timer);
      setSongFeed(null);
      heard.stop();
    };
    // grid va por su clave: es un objeto nuevo en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, songId, gridKey]);

  return {
    songId,
    playing,
    positionMs,
    bpm: playing ? (grid?.bpm ?? null) : null,
    error,
    play: (id) => void play(id),
    toggle,
    next: () => step(1),
    prev: () => step(-1),
    seek: (ms) => {
      if (!audioRef.current) return;
      audioRef.current.currentTime = Math.max(0, ms / 1000);
      setPositionMs(ms);
    },
  };
}
