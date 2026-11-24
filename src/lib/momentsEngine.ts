import { useEffect, useRef, useState } from "react";
import { useChasePlayer } from "@/lib/chasePlayer";
import { fadeValue, snapChannelIds, type ChannelValues } from "@/lib/fade";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Scene } from "@/types/scene";

const TICK_MS = 40; // ~25fps, igual que chasePlayer y effectEngine

/** El rig entero según la escena: lo que no define vuelve a su default (ver
 *  Moment.sceneId). */
function fullTarget(
  scene: Scene,
  instances: FixtureInstance[],
  definitions: FixtureDefinition[],
): ChannelValues {
  const target: ChannelValues = {};
  for (const instance of instances) {
    const definition = definitions.find((d) => d.id === instance.definitionId);
    if (!definition) continue;
    target[instance.id] = Object.fromEntries(
      definition.channels.map((c) => [c.id, scene.values[instance.id]?.[c.id] ?? c.defaultValue]),
    );
  }
  return target;
}

function mapValues(
  values: ChannelValues,
  f: (instanceId: string, channelId: string, value: number) => number,
): ChannelValues {
  return Object.fromEntries(
    Object.entries(values).map(([instanceId, channels]) => [
      instanceId,
      Object.fromEntries(
        Object.entries(channels).map(([channelId, v]) => [channelId, f(instanceId, channelId, v)]),
      ),
    ]),
  );
}

/**
 * Motor de Momentos. Como useEffectsEngine, se monta una sola vez en App: el
 * momento sigue corriendo aunque se cambie de sección. Cada arranque
 * (`momentRun.nonce`) hace fade hacia la escena y, al llegar, enciende los
 * effects y el chase — antes no, porque pelearían con el fade por los mismos
 * canales y las luces parpadearían.
 */
export function useMomentsEngine() {
  const store = useFixtureStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  const fade = useRef<{ nonce: number; from: ChannelValues; to: ChannelValues; done: boolean } | null>(null);
  const advancedNonce = useRef<number | null>(null);
  const [fadedNonce, setFadedNonce] = useState<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      const s = storeRef.current;
      const run = s.momentRun;
      const moment = s.moments.find((m) => m.id === s.activeMomentId);
      if (!run || !moment) return;

      if (fade.current?.nonce !== run.nonce) {
        const scene = s.scenes.find((sc) => sc.id === moment.sceneId);
        const to = scene ? fullTarget(scene, s.instances, s.definitions) : {};
        const from = mapValues(to, (instanceId, channelId, v) => s.getChannelValue(instanceId, channelId, v));
        fade.current = { nonce: run.nonce, from, to, done: false };
      }

      const elapsed = Date.now() - run.startedAt;
      const current = fade.current;
      if (!current.done) {
        const t = moment.fadeMs > 0 ? Math.min(1, elapsed / moment.fadeMs) : 1;
        const snap = snapChannelIds(s.definitions);
        s.setChannelValues(
          mapValues(current.to, (instanceId, channelId, v) =>
            fadeValue(current.from[instanceId][channelId], v, t, snap.has(channelId)),
          ),
        );
        if (t >= 1) {
          current.done = true;
          moment.effectIds.forEach(s.startEffect);
          setFadedNonce(run.nonce);
        }
      }

      // Una sola vez por arranque: si la UI va lenta, el siguiente tick
      // todavía vería el momento viejo y relanzaría el nuevo desde cero.
      const next = s.moments[s.moments.indexOf(moment) + 1];
      if (
        next &&
        moment.durationSec !== null &&
        elapsed >= moment.durationSec * 1000 &&
        advancedNonce.current !== run.nonce
      ) {
        advancedNonce.current = run.nonce;
        s.startMoment(next.id);
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const { momentRun, activeMomentId, moments, chases, scenes, definitions, getChannelValue, setChannelValue } = store;
  const faded = momentRun !== null && momentRun.nonce === fadedNonce;
  const moment = faded ? moments.find((m) => m.id === activeMomentId) : undefined;
  const chase = chases.find((c) => c.id === moment?.chaseId) ?? null;
  const { play, stop } = useChasePlayer({ chase, scenes, definitions, getChannelValue, setChannelValue });

  const chaseId = chase?.id;
  useEffect(() => {
    if (chaseId) play();
    else stop();
  }, [chaseId, fadedNonce, play, stop]);
}
