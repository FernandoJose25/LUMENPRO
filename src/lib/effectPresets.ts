import type { Effect } from "@/types/effect";
import type { ChannelType, FixtureDefinition, FixtureInstance } from "@/types/fixture";
import type { Group } from "@/types/group";

export type EffectDraft = Omit<Effect, "id" | "createdAt" | "updatedAt">;

const BASE: Omit<EffectDraft, "name" | "groupId"> = {
  kind: "wave",
  figure: "circle",
  sizeDeg: 20,
  angleDeg: 0,
  channelType: "DIMMER",
  waveform: "sine",
  speedCpm: 20,
  min: 0,
  max: 255,
  phaseOffsetDeg: 0,
  source: "clock",
  beatsPerCycle: 1,
};

export interface EffectPreset {
  name: string;
  text: string;
  /** Lo que tienen que tener las luces del grupo para que se note. */
  needs: ChannelType;
  /** Solo para barras o tiras de varios puntos. */
  pixels?: boolean;
  /** Uno por canal: un arcoíris son tres. */
  parts: { name: string; patch: Partial<EffectDraft> }[];
}

const one = (patch: Partial<EffectDraft>) => [{ name: "", patch }];
const figure = (patch: Partial<EffectDraft>): Partial<EffectDraft> => ({
  kind: "figure",
  channelType: "PAN",
  phaseOffsetDeg: 180,
  ...patch,
});

const pixels = (patch: Partial<EffectDraft>) => one({ kind: "pixels", channelType: "RED", speedCpm: 30, ...patch });

export const EFFECT_PRESETS: EffectPreset[] = [
  {
    name: "Píxeles: arcoíris que corre",
    text: "Los colores del arcoíris corren a lo largo de la barra o la tira.",
    needs: "RED",
    pixels: true,
    parts: pixels({ pattern: "rainbow" }),
  },
  {
    name: "Píxeles: punto que corre",
    text: "Un punto de color recorre la barra dejando estela, al ritmo.",
    needs: "RED",
    pixels: true,
    parts: pixels({ pattern: "chase", color: "#ff00ff", source: "beat", beatsPerCycle: 4 }),
  },
  {
    name: "Píxeles: destellos",
    text: "Puntos blancos que destellan al azar, como brillitos.",
    needs: "RED",
    pixels: true,
    parts: pixels({ pattern: "sparkle", color: "#ffffff", speedCpm: 40 }),
  },
  {
    name: "Píxeles: vúmetro",
    text: "La barra se llena con los graves: verde abajo, rojo arriba.",
    needs: "RED",
    pixels: true,
    parts: pixels({ pattern: "meter", source: "bass" }),
  },
  {
    name: "Arcoíris",
    text: "Los colores van y vienen solos, cada luz a su tiempo.",
    needs: "RED",
    parts: [
      { name: "rojo", patch: { channelType: "RED", speedCpm: 30, phaseOffsetDeg: 90 } },
      { name: "verde", patch: { channelType: "GREEN", speedCpm: 37, phaseOffsetDeg: 90 } },
      { name: "azul", patch: { channelType: "BLUE", speedCpm: 44, phaseOffsetDeg: 90 } },
    ],
  },
  {
    name: "Arcoíris al ritmo",
    text: "Igual, pero siguiendo los golpes de la música.",
    needs: "RED",
    parts: [
      { name: "rojo", patch: { channelType: "RED", phaseOffsetDeg: 90, source: "beat", beatsPerCycle: 4 } },
      { name: "verde", patch: { channelType: "GREEN", phaseOffsetDeg: 90, source: "beat", beatsPerCycle: 6 } },
      { name: "azul", patch: { channelType: "BLUE", phaseOffsetDeg: 90, source: "beat", beatsPerCycle: 8 } },
    ],
  },
  {
    name: "Respirar",
    text: "Suben y bajan despacio, todas juntas. Para el vals o la entrada.",
    needs: "DIMMER",
    parts: one({ speedCpm: 10, min: 40 }),
  },
  {
    name: "Ola",
    text: "Una ola de luz que recorre el grupo.",
    needs: "DIMMER",
    parts: one({ speedCpm: 30, phaseOffsetDeg: 90 }),
  },
  {
    name: "Persecución",
    text: "Se encienden de a una, en fila.",
    needs: "DIMMER",
    parts: one({ waveform: "square", speedCpm: 60, phaseOffsetDeg: 90 }),
  },
  {
    name: "Destellos",
    text: "Fogonazos cortos, salteados.",
    needs: "DIMMER",
    parts: one({ waveform: "pulse", speedCpm: 90, phaseOffsetDeg: 137 }),
  },
  {
    name: "Golpe al ritmo",
    text: "Un fogonazo en cada golpe de la música; entre golpes, a oscuras.",
    needs: "DIMMER",
    parts: one({ waveform: "pulse", source: "beat", beatsPerCycle: 1 }),
  },
  {
    name: "Golpe de graves",
    text: "Brillan con los bajos de la música; sin música, apagadas.",
    needs: "DIMMER",
    parts: one({ waveform: "pulse", source: "bass" }),
  },
  {
    name: "Círculo",
    text: "Las cabezas dibujan un círculo lento donde estén apuntando.",
    needs: "PAN",
    parts: one(figure({ figure: "circle", sizeDeg: 15, speedCpm: 10 })),
  },
  {
    name: "Ocho",
    text: "Un ocho rápido, en espejo. Para la hora loca.",
    needs: "PAN",
    parts: one(figure({ figure: "eight", sizeDeg: 30, speedCpm: 18 })),
  },
  {
    name: "Barrido",
    text: "Van de un lado al otro.",
    needs: "PAN",
    parts: one(figure({ figure: "line", sizeDeg: 35, speedCpm: 15 })),
  },
  {
    name: "Abanico",
    text: "Se abren y se cierran como un abanico.",
    needs: "PAN",
    parts: one(figure({ figure: "fan", sizeDeg: 40, speedCpm: 12, phaseOffsetDeg: 0 })),
  },
  {
    name: "Ocho al ritmo",
    text: "El ocho, siguiendo los golpes de la música.",
    needs: "PAN",
    parts: one(figure({ figure: "eight", sizeDeg: 30, source: "beat", beatsPerCycle: 8 })),
  },
];

interface Rig {
  instances: FixtureInstance[];
  definitions: FixtureDefinition[];
}

/** Si alguna luz del grupo tiene ese tipo de canal. */
export function groupHas(rig: Rig, groupId: string, type: ChannelType): boolean {
  return rig.instances.some(
    (i) => i.group === groupId && rig.definitions.find((d) => d.id === i.definitionId)?.channels.some((c) => c.type === type),
  );
}

/** El grupo tiene una barra o tira de varios puntos. */
export function groupHasPixels(rig: Rig, groupId: string): boolean {
  return rig.instances.some(
    (i) => i.group === groupId && (rig.definitions.find((d) => d.id === i.definitionId)?.heads?.length ?? 0) > 1,
  );
}

/** Los effects de ese preset para ese grupo, listos para agregar. */
export function presetEffects(preset: EffectPreset, group: Group): EffectDraft[] {
  return preset.parts.map((part) => ({
    ...BASE,
    ...part.patch,
    name: `${group.name}: ${preset.name.toLowerCase()}${part.name ? ` ${part.name}` : ""}`,
    groupId: group.id,
  }));
}
