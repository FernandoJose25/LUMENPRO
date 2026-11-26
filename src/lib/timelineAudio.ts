import { useEffect, useRef } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { positionOf } from "@/lib/engineClock";
import { readSetting, writeSetting } from "@/lib/settings";
import { songUrl } from "@/lib/songs";

/** Cada cuánto se le dice al motor por dónde va la canción. */
const SYNC_MS = 500;
/** Más separadas que esto, la canción salta a donde van las luces (al
 *  arrancar desde el celular o al volver a abrir la ventana). */
const JUMP_S = 0.3;

type SinkAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

let audio: SinkAudio | null = null;
const player = () => (audio ??= new Audio() as SinkAudio);

/** Por dónde sale la canción ("" = la salida de Windows). */
export function songOutput(): string {
  return readSetting<string>("song.output") ?? "";
}

export function setSongOutput(id: string): void {
  writeSetting("song.output", id || null);
  player().setSinkId?.(id).catch((e) => console.error("No se pudo cambiar la salida de audio", e));
}

/**
 * Hace sonar la canción de la línea de tiempo que corre en el motor, la
 * arranque quien la arranque (la ventana, el celular o un botón MIDI). La
 * canción manda: el motor corre sus luces a donde ella va.
 */
export function useTimelineAudio(): void {
  const { timeline, timelines, engine } = useFixtureStore();
  const song = (timeline && timelines.find((t) => t.id === timeline.id)?.song) || null;
  const loaded = useRef<string | null>(null);
  // Por valor: el estado del motor llega como objeto nuevo muchas veces por
  // segundo (el chase avanza) y cada vez se cortaría el aviso al motor.
  const id = timeline?.id ?? null;
  const startedAt = timeline?.startedAt ?? 0;
  const pausedAt = timeline?.pausedAt ?? null;
  const file = song?.file ?? null;
  const name = song?.name ?? "";

  useEffect(() => {
    const audio = player();
    const run = id === null ? null : { id, startedAt, pausedAt };
    const song = file === null ? null : { file, name };
    if (!run || !song) {
      audio.pause();
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    songUrl(song).then(
      (url) => {
        if (!alive) return;
        if (loaded.current !== url) {
          audio.src = url;
          loaded.current = url;
          if (songOutput()) audio.setSinkId?.(songOutput()).catch(() => {});
        }
        const at = positionOf(run) / 1000;
        if (run.pausedAt !== null) {
          audio.pause();
          audio.currentTime = at;
          return;
        }
        if (audio.paused || Math.abs(audio.currentTime - at) > JUMP_S) audio.currentTime = at;
        audio.play()?.catch((e: unknown) => console.error("No suena la canción", e));
        timer = setInterval(() => {
          if (!audio.paused) engine.send({ type: "timelineSync", id: run.id, positionMs: Math.round(audio.currentTime * 1000) });
        }, SYNC_MS);
      },
      (e: unknown) => console.error(e),
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, startedAt, pausedAt, file, name, engine]);
}
