import { lookValues, type Look } from "@/lib/look";
import type { Effect } from "@/types/effect";
import type { ChannelType, FixtureDefinition, FixtureInstance } from "@/types/fixture";
import { GROUP_COLORS, type Group } from "@/types/group";
import type { Moment } from "@/types/moment";
import type { Scene } from "@/types/scene";

interface Rig {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
  groups: Group[];
}

interface QuinceTemplate {
  instances: FixtureInstance[];
  groups: Group[];
  scenes: Scene[];
  effects: Effect[];
  moments: Moment[];
}

const rgb = (red: number, green: number, blue: number, dimmer: number): Look => ({
  DIMMER: dimmer,
  RED: red,
  GREEN: green,
  BLUE: blue,
});

const WHITE: Look = { ...rgb(255, 255, 255, 255), WHITE: 255 };
const HEADS_OFF: Look = { DIMMER: 0 };
// Las cabezas LED encienden con sus colores; las de lámpara ignoran eso.
const HEADS_WHITE: Look = WHITE;

/**
 * Los momentos de una quinceañera armados sobre el rig que haya. Trabaja por
 * tipo de canal (nunca por número), así sirve aunque después se corrijan los
 * canales de las cabezas. Es un punto de partida para editar, no un show
 * cerrado.
 */
export function buildQuinceTemplate(rig: Rig, makeId: (prefix: string) => string): QuinceTemplate {
  const groups = [...rig.groups];
  let instances = [...rig.instances];
  const definitionOf = (i: FixtureInstance) => rig.definitions.find((d) => d.id === i.definitionId);
  const has = (i: FixtureInstance, type: ChannelType) =>
    definitionOf(i)?.channels.some((c) => c.type === type) ?? false;

  // Un láser no se enciende solo con una plantilla.
  const lights = instances.filter((i) => definitionOf(i)?.kind !== "Laser");
  const heads = lights.filter((i) => has(i, "PAN"));
  const pars = lights.filter((i) => !has(i, "PAN") && has(i, "RED"));

  /** El grupo del primer fixture; si no tiene, uno nuevo con los que estén
   *  sueltos. Nunca saca a nadie de un grupo que ya armó el usuario. */
  function groupFor(members: FixtureInstance[], name: string): string | null {
    if (members.length === 0) return null;
    if (members[0].group) return members[0].group;
    const group: Group = { id: makeId("group"), name, color: GROUP_COLORS[groups.length % GROUP_COLORS.length] };
    groups.push(group);
    const ids = new Set(members.filter((m) => !m.group).map((m) => m.id));
    instances = instances.map((i) => (ids.has(i.id) ? { ...i, group: group.id } : i));
    return group.id;
  }
  const headsGroup = groupFor(heads, "Cabezas");
  const parsGroup = groupFor(pars, "PAR");

  const now = Date.now();
  const effects: Effect[] = [];
  const scenes: Scene[] = [];
  const moments: Moment[] = [];

  function effect(
    groupId: string | null,
    name: string,
    channelType: ChannelType,
    speedCpm: number,
    min: number,
    max: number,
    phaseOffsetDeg: number,
    music: Partial<Effect> = {},
  ): string[] {
    if (!groupId) return [];
    const id = makeId("effect");
    effects.push({
      id, name, groupId, kind: "wave", figure: "circle", sizeDeg: 20, angleDeg: 0, channelType, waveform: "sine",
      speedCpm, min, max, phaseOffsetDeg, source: "clock", beatsPerCycle: 1, createdAt: now, updatedAt: now, ...music,
    });
    return [id];
  }

  /** Las cabezas dibujan una figura alrededor de donde apunte la escena. */
  function figure(name: string, shape: Effect["figure"], sizeDeg: number, speedCpm: number, music: Partial<Effect> = {}) {
    return effect(headsGroup, name, "PAN", speedCpm, 0, 255, 180, { kind: "figure", figure: shape, sizeDeg, ...music });
  }

  // Alrededor de donde apunte la escena. Con 180° de desfase las dos cabezas
  // van en espejo.
  const slowPan = figure("Cabezas: círculo lento", "circle", 12, 5);
  const fastMove = figure("Cabezas: ocho fiesta", "eight", 35, 18);
  // Velocidades distintas para que los tres colores nunca vayan a la par.
  const rainbow = [
    ...effect(parsGroup, "PAR: ola roja", "RED", 30, 0, 255, 90),
    ...effect(parsGroup, "PAR: ola verde", "GREEN", 37, 0, 255, 90),
    ...effect(parsGroup, "PAR: ola azul", "BLUE", 44, 0, 255, 90),
  ];
  // Los mismos, siguiendo la música si se está escuchando.
  const musicRainbow = [
    ...effect(parsGroup, "PAR: rojo al ritmo", "RED", 30, 0, 255, 90, { source: "beat", beatsPerCycle: 4 }),
    ...effect(parsGroup, "PAR: verde al ritmo", "GREEN", 37, 0, 255, 90, { source: "beat", beatsPerCycle: 6 }),
    ...effect(parsGroup, "PAR: azul al ritmo", "BLUE", 44, 0, 255, 90, { source: "beat", beatsPerCycle: 8 }),
    ...effect(parsGroup, "PAR: golpe de graves", "DIMMER", 120, 40, 255, 0, { source: "bass", waveform: "pulse" }),
  ];
  const musicMove = figure("Cabezas: ocho al ritmo", "eight", 35, 18, { source: "beat", beatsPerCycle: 8 });

  function moment(name: string, fadeMs: number, parLook: Look, headLook: Look, effectIds: string[] = []) {
    const scene: Scene = {
      id: makeId("scene"),
      name,
      values: {
        ...lookValues(pars, rig.definitions, parLook),
        ...lookValues(heads, rig.definitions, headLook),
      },
      createdAt: now,
      updatedAt: now,
    };
    scenes.push(scene);
    moments.push({
      id: makeId("moment"), name, sceneId: scene.id, chaseId: null, effectIds, fadeMs, durationSec: null,
    });
  }

  moment("Recepción", 3000, rgb(255, 110, 20, 150), HEADS_OFF);
  moment("Entrada", 2000, rgb(120, 0, 255, 200), HEADS_WHITE);
  moment("Vals", 3000, { ...WHITE, DIMMER: 140 }, HEADS_WHITE, slowPan);
  moment("Fotos", 1000, WHITE, HEADS_WHITE);
  moment("Brindis", 2000, rgb(255, 160, 30, 200), { DIMMER: 120 });
  moment("Hora loca", 500, rgb(0, 0, 0, 255), HEADS_WHITE, [...rainbow, ...fastMove]);
  moment("Hora loca + estrobo", 0, { ...rgb(0, 0, 0, 255), STROBE: 200 }, HEADS_WHITE, [...rainbow, ...fastMove]);
  moment("Hora loca con música", 500, rgb(0, 0, 0, 255), HEADS_WHITE, [...musicRainbow, ...musicMove]);
  moment("Cierre", 3000, { ...WHITE, DIMMER: 180 }, HEADS_OFF);

  return { instances, groups, scenes, effects, moments };
}
