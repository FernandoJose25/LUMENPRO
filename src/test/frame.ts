import type { FrameInput } from "@/lib/dmxFrame";
import { WasmShow } from "@/lib/wasmEngine";
import type { ShowDoc } from "@/lib/history";

/** Los 512 canales que el motor saca con ese rig y esos valores. */
export function buildFrame(input: FrameInput, universe = 1): number[] {
  const { instances, definitions, blackoutActive, master, strobeActive, identifyId } = input;
  const liveValues = { ...input.liveValues };
  for (const [id, channels] of Object.entries(input.moving ?? {})) liveValues[id] = { ...liveValues[id], ...channels };
  const doc: ShowDoc = {
    definitions, instances, scenes: [], palettes: [], groups: [], chases: [], effects: [], moments: [], livePads: [],
    phonePads: [], controls: [],
  };
  const show = new WasmShow();
  show.send({ type: "reset", doc, live: liveValues, activeSceneId: null, activeMomentId: null }, 0);
  show.send({ type: "blackout", on: blackoutActive }, 0);
  show.send({ type: "master", value: master }, 0);
  show.send({ type: "strobe", on: strobeActive }, 0);
  if (identifyId !== null) show.send({ type: "identify", id: identifyId }, 0);
  return show.frame(universe);
}
