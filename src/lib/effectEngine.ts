import { useEffect, useRef } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { WaveformType } from "@/types/effect";

const TICK_MS = 40; // ~25fps, igual que chasePlayer

function waveformValue(waveform: WaveformType, phaseCycles: number, min: number, max: number): number {
  // Normalizar la fase (que puede acumular muchos ciclos con el tiempo) a [0, 1).
  const p = phaseCycles - Math.floor(phaseCycles);
  let t: number;
  switch (waveform) {
    case "square":
      t = p < 0.5 ? 1 : 0;
      break;
    case "sawtooth":
      t = p;
      break;
    case "triangle":
      t = p < 0.5 ? p * 2 : (1 - p) * 2;
      break;
    case "sine":
    default:
      t = 0.5 + 0.5 * Math.sin(2 * Math.PI * p);
      break;
  }
  return Math.round(min + (max - min) * t);
}

/**
 * Motor de Effects. A diferencia de useChasePlayer (un hook por chase,
 * usado solo mientras esa vista está abierta), este es UN ÚNICO intervalo
 * global que recorre todos los `runningEffectIds` en cada tick — se monta
 * una sola vez en App.tsx, no en EffectsView, para que un efecto siga
 * animando aunque el usuario navegue a otra sección del Sidebar (igual
 * que en una consola real, donde un efecto activo no se detiene por
 * cambiar de pantalla).
 *
 * Cada fixture del grupo objetivo recibe un desfase de fase según su
 * posición en el array de instancias del grupo (no hay un orden "oficial"
 * de fixtures dentro de un grupo todavía — ver limitación en
 * PASOS-PENDIENTES.md).
 */
export function useEffectsEngine() {
  const { effects, runningEffectIds, instances, definitions, setChannelValue } = useFixtureStore();

  const effectsRef = useRef(effects);
  const runningRef = useRef(runningEffectIds);
  const instancesRef = useRef(instances);
  const definitionsRef = useRef(definitions);
  const setChannelValueRef = useRef(setChannelValue);
  effectsRef.current = effects;
  runningRef.current = runningEffectIds;
  instancesRef.current = instances;
  definitionsRef.current = definitions;
  setChannelValueRef.current = setChannelValue;

  // Timestamp de arranque de cada efecto — se reinicia cada vez que un
  // efecto pasa de detenido a corriendo, así la fase siempre arranca en 0
  // al presionar "Reproducir" (comportamiento predecible/testeable).
  const startTimesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = setInterval(() => {
      const running = runningRef.current;

      // Limpiar timestamps de efectos que ya no están corriendo, para que
      // si se vuelven a arrancar más tarde, la fase reinicie desde 0.
      for (const id of Object.keys(startTimesRef.current)) {
        if (!running.includes(id)) delete startTimesRef.current[id];
      }
      if (running.length === 0) return;

      const now = Date.now();
      for (const effectId of running) {
        const effect = effectsRef.current.find((e) => e.id === effectId);
        if (!effect || !effect.groupId) continue;
        if (!(effectId in startTimesRef.current)) startTimesRef.current[effectId] = now;

        const elapsedSec = (now - startTimesRef.current[effectId]) / 1000;
        const cyclesPerSec = effect.speedCpm / 60;
        const members = instancesRef.current.filter((i) => i.group === effect.groupId);

        members.forEach((member, index) => {
          const def = definitionsRef.current.find((d) => d.id === member.definitionId);
          if (!def) return;
          const phase = elapsedSec * cyclesPerSec + (index * effect.phaseOffsetDeg) / 360;
          for (const channel of def.channels) {
            if (channel.type !== effect.channelType) continue;
            setChannelValueRef.current(
              member.id,
              channel.id,
              waveformValue(effect.waveform, phase, effect.min, effect.max),
            );
          }
        });
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
