import { useCallback, useEffect, useRef, useState } from "react";
import type { Chase } from "@/types/chase";
import type { Scene } from "@/types/scene";

interface UseChasePlayerArgs {
  chase: Chase | null;
  scenes: Scene[];
  getChannelValue: (instanceId: string, channelId: string, fallback: number) => number;
  setChannelValue: (instanceId: string, channelId: string, value: number) => void;
}

export interface ChasePlaybackStatus {
  playing: boolean;
  stepIndex: number;
  phase: "fade" | "hold" | "idle";
  /** Progreso 0..1 dentro de la fase actual (no del chase completo). */
  progress: number;
}

const IDLE_STATUS: ChasePlaybackStatus = { playing: false, stepIndex: 0, phase: "idle", progress: 0 };

// ~25 fps: de sobra para que un crossfade de luces se vea suave sin
// saturar el store con setChannelValue en cada canal en cada frame.
const TICK_MS = 40;

/**
 * Motor de reproducción de Chases, corriendo en el navegador (no hay
 * motor DMX conectado al frontend todavía — ver AUDIT.md §8). En vez de
 * animar directamente hacia los valores fijos de la Scene, cada step
 * arranca su fade desde lo que esté en vivo en ESE momento (no desde el
 * step anterior "en teoría") — así si el usuario movió algo a mano
 * mientras el chase corría, el siguiente fade sigue siendo suave en vez
 * de saltar.
 */
export function useChasePlayer({ chase, scenes, getChannelValue, setChannelValue }: UseChasePlayerArgs) {
  const [status, setStatus] = useState<ChasePlaybackStatus>(IDLE_STATUS);

  const chaseRef = useRef(chase);
  const scenesRef = useRef(scenes);
  const getChannelValueRef = useRef(getChannelValue);
  const setChannelValueRef = useRef(setChannelValue);
  chaseRef.current = chase;
  scenesRef.current = scenes;
  getChannelValueRef.current = getChannelValue;
  setChannelValueRef.current = setChannelValue;

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepIndexRef = useRef(0);
  const phaseRef = useRef<"fade" | "hold">("fade");
  const phaseStartAtRef = useRef(0);
  const fadeFromRef = useRef<Record<string, Record<string, number>>>({});

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const beginStep = useCallback((index: number) => {
    const c = chaseRef.current;
    if (!c || !c.steps[index]) return;
    const step = c.steps[index];
    const scene = scenesRef.current.find((s) => s.id === step.sceneId);

    const from: Record<string, Record<string, number>> = {};
    if (scene) {
      for (const [instanceId, channels] of Object.entries(scene.values)) {
        from[instanceId] = {};
        for (const [channelId, target] of Object.entries(channels)) {
          from[instanceId][channelId] = getChannelValueRef.current(instanceId, channelId, target);
        }
      }
    }
    fadeFromRef.current = from;
    stepIndexRef.current = index;
    phaseRef.current = step.fadeMs > 0 ? "fade" : "hold";
    phaseStartAtRef.current = Date.now();
    setStatus({ playing: true, stepIndex: index, phase: phaseRef.current, progress: 0 });
  }, []);

  const advance = useCallback(() => {
    const c = chaseRef.current;
    if (!c) return;
    const next = stepIndexRef.current + 1;
    if (next >= c.steps.length) {
      if (c.loop && c.steps.length > 0) {
        beginStep(0);
      } else {
        clearTimer();
        setStatus(IDLE_STATUS);
      }
    } else {
      beginStep(next);
    }
  }, [beginStep]);

  const tick = useCallback(() => {
    const c = chaseRef.current;
    const step = c?.steps[stepIndexRef.current];
    if (!c || !step) return;
    const scene = scenesRef.current.find((s) => s.id === step.sceneId);
    const elapsed = Date.now() - phaseStartAtRef.current;

    if (phaseRef.current === "fade") {
      const dur = Math.max(step.fadeMs, 1);
      const t = Math.min(1, elapsed / dur);
      if (scene) {
        for (const [instanceId, channels] of Object.entries(scene.values)) {
          for (const [channelId, target] of Object.entries(channels)) {
            const from = fadeFromRef.current[instanceId]?.[channelId] ?? target;
            setChannelValueRef.current(instanceId, channelId, Math.round(from + (target - from) * t));
          }
        }
      }
      setStatus({ playing: true, stepIndex: stepIndexRef.current, phase: "fade", progress: t });
      if (t >= 1) {
        phaseRef.current = "hold";
        phaseStartAtRef.current = Date.now();
      }
    } else {
      const dur = Math.max(step.holdMs, 0);
      const t = dur === 0 ? 1 : Math.min(1, elapsed / dur);
      setStatus({ playing: true, stepIndex: stepIndexRef.current, phase: "hold", progress: t });
      if (t >= 1) advance();
    }
  }, [advance]);

  const play = useCallback(() => {
    if (!chaseRef.current || chaseRef.current.steps.length === 0) return;
    clearTimer();
    beginStep(0);
    timerRef.current = setInterval(tick, TICK_MS);
  }, [beginStep, tick]);

  const stop = useCallback(() => {
    clearTimer();
    setStatus(IDLE_STATUS);
  }, []);

  // Si el chase seleccionado cambia (o se desmonta el componente que usa
  // este hook), detener la reproducción en vez de seguir animando un
  // chase que ya no es el visible.
  useEffect(() => {
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chase?.id]);
  useEffect(() => () => clearTimer(), []);

  return { status, play, stop };
}
