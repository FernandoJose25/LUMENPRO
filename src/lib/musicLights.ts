import { useCallback, useRef, useState } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { readSetting, writeSetting } from "@/lib/settings";

export interface MusicLights {
  /** Algún efecto prendido sigue la música (ritmo, graves, medios o agudos). */
  following: boolean;
  /** El momento que pone las luces a seguir la música («Hora loca con música»
   *  en la plantilla), si hay uno. */
  musicMoment: { id: string; name: string } | null;
  /** Prenderlo solo al poner música desde Música. */
  auto: boolean;
  setAuto: (on: boolean) => void;
  follow: () => void;
  /** Al empezar a sonar algo desde Música. */
  onMusicStart: () => void;
}

/** Que el simulador y las luces sigan la música que suena en Música: sin un
 *  efecto que siga el ritmo o los graves, oír la música no mueve nada. */
export function useMusicLights(): MusicLights {
  const { effects, runningEffectIds, moments, startMoment } = useFixtureStore();
  const [auto, setAutoState] = useState(() => readSetting<boolean>("music.autoLights") ?? true);

  const followsMusic = (id: string) => effects.some((fx) => fx.id === id && fx.source !== "clock");
  const following = runningEffectIds.some(followsMusic);
  const candidates = moments.filter((m) => m.effectIds.some(followsMusic));
  const moment = candidates.find((m) => /m[uú]sica/i.test(m.name)) ?? candidates[0];
  const musicMoment = moment ? { id: moment.id, name: moment.name } : null;

  const now = useRef({ following, musicMoment, auto });
  now.current = { following, musicMoment, auto };

  const follow = useCallback(() => {
    const target = now.current.musicMoment;
    if (target) startMoment(target.id);
  }, [startMoment]);

  const onMusicStart = useCallback(() => {
    const { following, musicMoment, auto } = now.current;
    if (auto && !following && musicMoment) startMoment(musicMoment.id);
  }, [startMoment]);

  const setAuto = useCallback((on: boolean) => {
    setAutoState(on);
    writeSetting("music.autoLights", on);
  }, []);

  return { following, musicMoment, auto, setAuto, follow, onMusicStart };
}
