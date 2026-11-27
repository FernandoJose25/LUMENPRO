import type { FrameInput } from "@/lib/dmxFrame";
import { audioMessage } from "@/lib/engineLink";
import type { ChannelValues } from "@/lib/fade";
import { heldValues, tintedGroups } from "@/lib/palettes";
import type { Effect } from "@/types/effect";
import { fetchWasm, WasmShow } from "@/lib/wasmEngine";
import type { EngineDoc, EngineMessage, Playback } from "@/types/engine";
import type { Group } from "@/types/group";

const TICK_MS = 40;

/** Por dónde arranca: lo que está pasando ahora en el show de verdad. */
export interface PreviewStart {
  doc: EngineDoc;
  liveValues: ChannelValues;
  playback: Playback;
}

/**
 * Un segundo motor, solo para mirar: corre igual que el del show pero no
 * manda nada por el cable. Lo que se prueba queda anotado para mandarlo
 * después a las luces tal cual.
 */
export class PreviewShow {
  readonly rig: FrameInput;
  playback: Playback;
  /** Lo que se probó, en orden. */
  readonly tried: EngineMessage[] = [];
  private readonly show = new WasmShow();
  private rev = 0;
  private groups: Group[];
  private effects: Effect[];
  private hadAudio = false;
  private readonly timer: ReturnType<typeof setInterval>;

  private constructor(start: PreviewStart, private readonly onPlayback: () => void) {
    const { doc, liveValues, playback } = start;
    this.groups = doc.groups;
    this.effects = doc.effects;
    this.playback = playback;
    this.rig = {
      instances: doc.instances,
      definitions: doc.definitions,
      liveValues,
      moving: {},
      held: {},
      blackoutActive: false,
      master: playback.master,
      strobeActive: false,
      identifyId: null,
    };
    const now = Date.now();
    const { activeSceneId, activeMomentId } = playback;
    this.show.send({ type: "reset", doc, live: liveValues, activeSceneId, activeMomentId }, now);
    // Con lo mismo encendido que el show de verdad.
    this.show.send({ type: "master", value: playback.master }, now);
    for (const id of playback.runningEffectIds) this.show.send({ type: "startEffect", id }, now);
    for (const [groupId, color] of Object.entries(playback.heldColors)) {
      this.show.send({ type: "action", action: { do: "color", groupId, color }, press: true }, now);
    }
    this.pull();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  static async start(start: PreviewStart, onPlayback: () => void): Promise<PreviewShow> {
    await fetchWasm();
    return new PreviewShow(start, onPlayback);
  }

  send(message: EngineMessage): void {
    this.tried.push(message);
    this.show.send(message, Date.now());
    this.pull();
  }

  /** El show se editó mientras se miraba. */
  setDoc(doc: EngineDoc): void {
    this.groups = doc.groups;
    this.effects = doc.effects;
    this.rig.instances = doc.instances;
    this.rig.definitions = doc.definitions;
    this.show.send({ type: "doc", doc }, Date.now());
    this.pull(true);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private tick(): void {
    // Lo que va "al ritmo" sigue a la música, si se está escuchando.
    const audio = audioMessage();
    if (audio || this.hadAudio) this.show.send({ type: "audio", audio }, Date.now());
    this.hadAudio = audio !== null;
    this.show.tick(Date.now());
    this.pull();
  }

  private pull(force = false): void {
    const changes = this.show.changes(this.rev);
    if (!changes) return;
    this.rev = changes.rev;
    const rig = this.rig;
    if (changes.full) rig.liveValues = changes.values;
    else {
      const merged = { ...rig.liveValues };
      for (const [id, channels] of Object.entries(changes.values)) merged[id] = { ...merged[id], ...channels };
      rig.liveValues = merged;
    }
    if (changes.moving) rig.moving = changes.moving;
    if (changes.playback || force) {
      if (changes.playback) this.playback = changes.playback;
      const p = this.playback;
      rig.blackoutActive = p.blackoutActive;
      rig.master = p.master;
      rig.strobeActive = p.strobeActive;
      rig.identifyId = p.identifyId;
      rig.held = heldValues(
        { instances: rig.instances, definitions: rig.definitions, groups: this.groups },
        p.heldColors,
        tintedGroups(this.effects, p.runningEffectIds),
      );
      this.onPlayback();
    }
  }
}
