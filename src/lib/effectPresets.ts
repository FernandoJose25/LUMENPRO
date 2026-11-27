import { FIGURE_LABELS, PIXEL_LABELS, WAVEFORM_LABELS, type Effect, type PixelPattern } from "@/types/effect";
import type { Action } from "@/types/controls";
import type { ShowDoc } from "@/lib/history";
import { CHANNEL_TYPE_LABELS, type ChannelType, type FixtureDefinition, type FixtureInstance } from "@/types/fixture";
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

/** Por tipo de luz, para no tenerlos todos juntos. */
export type EffectCategory = "color" | "dimmer" | "move" | "pixels" | "strobe";

export const EFFECT_CATEGORIES: { id: EffectCategory; name: string }[] = [
  { id: "move", name: "Cabezas móviles y beam" },
  { id: "pixels", name: "Barras y tiras de LEDs" },
  { id: "strobe", name: "Estrobos LED tipo Stormy (cortadora)" },
  { id: "color", name: "PAR y luces de color" },
  { id: "dimmer", name: "Brillo y estrobo (cualquier luz)" },
];

export interface EffectPreset {
  name: string;
  text: string;
  category: EffectCategory;
  /** Alguna luz del grupo tiene que tener uno de estos canales para que se note. */
  needs: ChannelType[];
  /** Solo para barras, tiras o estrobos de varios segmentos. */
  pixels?: boolean;
  /** Uno por canal: un arcoíris son tres. */
  parts: { name: string; patch: Partial<EffectDraft> }[];
}

type Entry = [name: string, text: string, patch: Partial<EffectDraft>];

const one = (patch: Partial<EffectDraft>) => [{ name: "", patch }];
const figure = (patch: Partial<EffectDraft>): Partial<EffectDraft> => ({
  kind: "figure",
  channelType: "PAN",
  phaseOffsetDeg: 180,
  ...patch,
});
const pixels = (pattern: PixelPattern, patch: Partial<EffectDraft> = {}): Partial<EffectDraft> => ({
  kind: "pixels",
  channelType: "RED",
  speedCpm: 30,
  pattern,
  ...patch,
});
const beat = (beatsPerCycle: number): Partial<EffectDraft> => ({ source: "beat", beatsPerCycle });

function list(category: EffectCategory, needs: ChannelType[], entries: Entry[], extra: Partial<EffectPreset> = {}) {
  return entries.map(([name, text, patch]): EffectPreset => ({ name, text, category, needs, parts: one(patch), ...extra }));
}

// Todos de píxeles: con Color fijo siguen igual, en ese color.
const COLOR: EffectPreset[] = [
  ...list("color", ["RED"], [
    ["Arcoíris", "Cada luz con un color del arcoíris, y los colores pasan de una a la otra.", pixels("rainbow", { speedCpm: 12 })],
    ["Arcoíris al ritmo", "El arcoíris, avanzando con los golpes de la música.", pixels("rainbow", beat(8))],
    ["Todos cambian de color", "Todas juntas pasan suave por todos los colores.", pixels("colorCycle", { speedCpm: 12 })],
    ["Salto de color", "Todas juntas saltan a otro color cada dos segundos.", pixels("jump")],
    ["Salto de color al ritmo", "Cada dos golpes de la música, todas a otro color. Para la hora loca.", pixels("jump", beat(2))],
    ["Policía", "Mitad rojo y mitad azul, turnándose rápido.", pixels("halves", { color: "#ff0000", color2: "#0000ff", speedCpm: 60 })],
    ["Dos colores alternados", "Uno sí y uno no: fucsia y celeste se turnan con el ritmo.", pixels("alternate", { color: "#ff00ff", color2: "#00ffff", ...beat(2) })],
    ["Rosa y dorado", "Rosado y dorado turnándose despacio. Para la entrada de la quinceañera.", pixels("alternate", { color: "#ff2a8a", color2: "#ffaa00", speedCpm: 8 })],
    ["Hielo", "Azul y blanco, despacio. Para el vals.", pixels("alternate", { color: "#0040ff", color2: "#ffffff", speedCpm: 10 })],
    ["Fuego", "Rojos y naranjas que titilan como llamas.", pixels("fire")],
    ["Confeti de colores", "Destellos de colores al azar.", pixels("confetti")],
    ["Persecución de color", "Un color que salta de luz en luz.", pixels("chase", { color: "#00ffff", speedCpm: 40 })],
    ["Ida y vuelta", "Un color que va y vuelve por la fila de luces, al ritmo.", pixels("bounce", { color: "#ff00ff", ...beat(4) })],
    ["Barrido de color", "El naranja barre las luces y el morado lo tapa.", pixels("wipe", { color: "#ff8800", color2: "#8000ff", speedCpm: 15 })],
    ["Color con los graves", "Un fogonazo de color con cada golpe del bombo; sin golpes, apagadas.", pixels("flash", { color: "#ff0000", source: "bass" })],
    ["Salto de color con los graves", "Con cada golpe del bombo, un fogonazo en otro color. Para la hora loca.", pixels("jump", { source: "bass" })],
  ]),
];

const DIMMER: EffectPreset[] = list("dimmer", ["DIMMER"], [
  ["Respirar", "Suben y bajan despacio, todas juntas. Para el vals o la entrada.", { speedCpm: 10, min: 40 }],
  ["Ola", "Una ola de luz que recorre el grupo.", { speedCpm: 30, phaseOffsetDeg: 90 }],
  ["Ola rápida", "La misma ola, al doble y más apretada.", { speedCpm: 90, phaseOffsetDeg: 60 }],
  ["Persecución", "Se encienden de a una, en fila.", { waveform: "square", speedCpm: 60, phaseOffsetDeg: 90 }],
  ["Escalera", "Suben de a poco y se apagan de golpe, una tras otra.", { waveform: "sawtooth", speedCpm: 30, phaseOffsetDeg: 45 }],
  ["Rebote", "La luz va y vuelve por la fila.", { waveform: "triangle", speedCpm: 40, phaseOffsetDeg: 90 }],
  ["Destellos", "Fogonazos cortos, salteados.", { waveform: "pulse", speedCpm: 90, phaseOffsetDeg: 137 }],
  ["Al azar", "Cada luz se prende o se apaga por su cuenta.", { waveform: "random", speedCpm: 60 }],
  ["Al azar al ritmo", "Igual, cambiando en cada golpe de la música.", { waveform: "random", ...beat(1) }],
  ["Latido", "Late como un corazón, todas juntas.", { waveform: "pulse", speedCpm: 70, min: 30 }],
  ["Estrobo", "Parpadeo rápido de todas juntas.", { waveform: "square", speedCpm: 480 }],
  ["Estrobo al ritmo", "Dos fogonazos por cada golpe de la música.", { waveform: "pulse", ...beat(0.5) }],
  ["Golpe al ritmo", "Un fogonazo en cada golpe de la música; entre golpes, a oscuras.", { waveform: "pulse", ...beat(1) }],
  ["Golpe de graves", "Un fogonazo con cada golpe del bombo: si el bombo va más rápido, la luz también; sin golpes, apagadas.", { waveform: "pulse", source: "bass" }],
  ["Al azar con los graves", "Con cada golpe del bombo se prenden otras luces, al azar. El clásico de discoteca.", { waveform: "random", source: "bass" }],
  ["Persecución con los graves", "Con cada golpe del bombo, la luz salta a las siguientes.", { waveform: "square", phaseOffsetDeg: 90, source: "bass", beatsPerCycle: 4 }],
  ["Golpe de caja", "Un fogonazo con cada golpe de caja o de palmas (el «chas» del dembow).", { waveform: "pulse", source: "mid" }],
  ["Brillo con los agudos", "Un destello con cada platillo.", { waveform: "pulse", source: "treble" }],
]);

const MOVE: EffectPreset[] = list("move", ["PAN"], [
  ["Círculo", "Las cabezas dibujan un círculo lento donde estén apuntando.", figure({ figure: "circle", sizeDeg: 15, speedCpm: 10 })],
  ["Círculo grande", "Un círculo amplio, cada cabeza a destiempo.", figure({ figure: "circle", sizeDeg: 40, speedCpm: 12, phaseOffsetDeg: 90 })],
  ["Remolino", "Círculos chicos y rápidos.", figure({ figure: "circle", sizeDeg: 12, speedCpm: 40, phaseOffsetDeg: 90 })],
  ["Círculo al ritmo", "El círculo, una vuelta cada cuatro golpes.", figure({ figure: "circle", sizeDeg: 20, ...beat(4) })],
  ["Ocho", "Un ocho rápido, en espejo. Para la hora loca.", figure({ figure: "eight", sizeDeg: 30, speedCpm: 18 })],
  ["Ocho al ritmo", "El ocho, siguiendo los golpes de la música.", figure({ figure: "eight", sizeDeg: 30, ...beat(8) })],
  ["Barrido", "Van de un lado al otro.", figure({ figure: "line", sizeDeg: 35, speedCpm: 15 })],
  ["Tijeras", "Se cruzan como tijeras: una para un lado y la otra para el otro. Ideal con beams y humo.", figure({ figure: "line", sizeDeg: 40, speedCpm: 20 })],
  ["Tijeras al ritmo", "Las tijeras, un cruce cada dos golpes.", figure({ figure: "line", sizeDeg: 40, ...beat(2) })],
  ["Ola horizontal", "De un lado al otro, una tras otra, como una ola.", figure({ figure: "line", sizeDeg: 30, speedCpm: 15, phaseOffsetDeg: 60 })],
  ["Ola vertical", "Suben y bajan una tras otra.", figure({ figure: "line", angleDeg: 90, sizeDeg: 25, speedCpm: 15, phaseOffsetDeg: 60 })],
  ["Péndulo", "Todas suben y bajan juntas, despacio.", figure({ figure: "line", angleDeg: 90, sizeDeg: 30, speedCpm: 12, phaseOffsetDeg: 0 })],
  ["Abanico", "Se abren y se cierran como un abanico.", figure({ figure: "fan", sizeDeg: 40, speedCpm: 12, phaseOffsetDeg: 0 })],
  ["Abanico al ritmo", "El abanico se abre y se cierra cada cuatro golpes.", figure({ figure: "fan", sizeDeg: 40, phaseOffsetDeg: 0, ...beat(4) })],
  ["Cuadrado", "Dibujan un cuadrado.", figure({ figure: "square", sizeDeg: 20, speedCpm: 10 })],
  ["Rombo", "Dibujan un rombo, en espejo.", figure({ figure: "diamond", sizeDeg: 25, speedCpm: 12 })],
  ["Triángulo", "Dibujan un triángulo.", figure({ figure: "triangle", sizeDeg: 20, speedCpm: 12 })],
  ["Ballyhoo", "Cada cabeza barre el salón por su cuenta, sin parar. El clásico de discoteca.", figure({ figure: "random", sizeDeg: 35, speedCpm: 20, phaseOffsetDeg: 0 })],
  ["Ballyhoo con los graves", "El ballyhoo se agranda con cada golpe del bombo y se achica despacio.", figure({ figure: "random", sizeDeg: 40, speedCpm: 20, phaseOffsetDeg: 0, source: "bass" })],
]);

const PIXELS: EffectPreset[] = list(
  "pixels",
  ["RED"],
  [
    ["Píxeles: arcoíris que corre", "Los colores del arcoíris corren a lo largo de la barra o la tira.", pixels("rainbow")],
    ["Píxeles: punto que corre", "Un punto de color recorre la barra dejando estela, al ritmo.", pixels("chase", { color: "#ff00ff", ...beat(4) })],
    ["Píxeles: destellos", "Puntos blancos que destellan al azar, como brillitos.", pixels("sparkle", { color: "#ffffff", speedCpm: 40 })],
    ["Píxeles: vúmetro", "La barra salta con cada golpe del bombo: verde abajo, rojo arriba.", pixels("meter", { source: "bass" })],
    ["Píxeles: auto fantástico", "Un punto rojo que va y vuelve.", pixels("bounce", { color: "#ff0000" })],
    ["Píxeles: se abre desde el centro", "Se abre desde el medio hacia las puntas y se cierra.", pixels("center", { color: "#00aaff" })],
    ["Píxeles: centro con los graves", "Se abre desde el medio con cada golpe del bombo.", pixels("center", { color: "#ff00ff", source: "bass" })],
    ["Píxeles: se llena y se vacía", "Se llena de color de una punta a la otra y se vacía.", pixels("fill", { color: "#ffaa00" })],
  ],
  { pixels: true },
);

// Sirven para cualquier luz de varios segmentos, también los de solo blanco.
const STROBE: EffectPreset[] = list(
  "strobe",
  ["RED", "WHITE", "DIMMER"],
  [
    ["Cortadora", "Un segmento a la vez, de lado a lado y de golpe. El efecto clásico del Stormy.", pixels("cutter", { color: "#ffffff", speedCpm: 60 })],
    ["Cortadora al ritmo", "Una pasada completa en cada golpe de la música.", pixels("cutter", { color: "#ffffff", ...beat(1) })],
    ["Cortadora en color", "La cortadora en celeste.", pixels("cutter", { color: "#00aaff", speedCpm: 60 })],
    ["Cortadora de ida y vuelta", "Va y vuelve rápido de punta a punta.", pixels("bounce", { color: "#ffffff", speedCpm: 90 })],
    ["Relámpagos", "Ráfagas de destellos al azar, como una tormenta.", pixels("lightning", { color: "#ffffff" })],
    ["Flash al golpe", "Todos los segmentos destellan juntos en cada golpe.", pixels("flash", { color: "#ffffff", ...beat(1) })],
    ["Flash con los graves", "Destellan con cada golpe del bombo; sin golpes, apagados.", pixels("flash", { color: "#ffffff", source: "bass" })],
    ["Cortadora con los graves", "Una pasada rápida con cada golpe del bombo; sin golpes, apagado.", pixels("cutter", { color: "#ffffff", source: "bass" })],
    ["Chispazos", "Segmentos sueltos que destellan rápido.", pixels("sparkle", { color: "#ffffff", speedCpm: 90 })],
    ["Destellos de colores", "Destellos de colores rápidos.", pixels("confetti", { speedCpm: 120 })],
    ["Mitad y mitad", "Una mitad y la otra, rápido.", pixels("halves", { color: "#ffffff", speedCpm: 120 })],
  ],
  { pixels: true },
);

export const EFFECT_PRESETS: EffectPreset[] = [...MOVE, ...PIXELS, ...STROBE, ...COLOR, ...DIMMER];

/** El nombre sin el grupo adelante: "PAR: latido" → "Latido". */
export function effectShortName(name: string, groupName?: string): string {
  const prefix = groupName ? `${groupName}: `.toLowerCase() : "";
  const rest = prefix && name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length) : name;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** Qué hace, en una frase: la del efecto listo si viene de uno; si no, sale de sus ajustes. */
export function describeEffect(fx: Effect, groupName?: string): string {
  const short = effectShortName(fx.name, groupName).toLowerCase();
  const preset = EFFECT_PRESETS.find((p) => p.name.toLowerCase() === short);
  if (preset) return preset.text;
  if (fx.kind === "figure") return `Mueve las cabezas (${FIGURE_LABELS[fx.figure].toLowerCase()}) alrededor de donde apuntan.`;
  if (fx.kind === "pixels") return `${PIXEL_LABELS[fx.pattern ?? "rainbow"]}.`;
  return `Onda ${WAVEFORM_LABELS[fx.waveform].toLowerCase()} sobre ${CHANNEL_TYPE_LABELS[fx.channelType]}.`;
}

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

/** Los efectos listos que se notan en ese grupo. */
export function presetsFor(rig: Rig, groupId: string): EffectPreset[] {
  const pixels = groupHasPixels(rig, groupId);
  return EFFECT_PRESETS.filter((p) => p.needs.some((type) => groupHas(rig, groupId, type)) && (!p.pixels || pixels));
}

/** Sube cuando el catálogo cambia: el show se pone al día una vez. */
// 4: otra vez lo de la 3, porque Deshacer podía devolver los pedazos.
// 5: los que siguen los golpes del bombo y de la caja (hora loca).
export const CATALOG_VERSION = 5;

/** En qué versión del catálogo apareció cada efecto listo nuevo (los demás,
 *  en la 1): al ponerse al día solo llegan los que no estaban. */
const SINCE: Record<string, number> = {
  "arcoíris": 2,
  "arcoíris al ritmo": 2,
  "color con los graves": 2,
  "salto de color con los graves": 5,
  "al azar con los graves": 5,
  "persecución con los graves": 5,
  "golpe de caja": 5,
  "cortadora con los graves": 5,
};

/** El mismo effect con otro nombre: va al nuevo también en los momentos. */
const RENAMED = new Set(["colores que corren", "rojo con los graves"]);

/**
 * Effects de antes que eran un pedazo de otro: una onda sobre un solo canal
 * de color (el arcoíris eran tres). Solos no se entienden (la "ola azul"
 * dejaba el verde que había) y el Color fijo los tapaba. Van al de la derecha.
 */
const PIECES: Record<string, string> = {
  "ola roja": "arcoíris",
  "ola verde": "arcoíris",
  "ola azul": "arcoíris",
  "rojo al ritmo": "arcoíris al ritmo",
  "verde al ritmo": "arcoíris al ritmo",
  "azul al ritmo": "arcoíris al ritmo",
  "arcoíris rojo": "arcoíris",
  "arcoíris verde": "arcoíris",
  "arcoíris azul": "arcoíris",
  "arcoíris al ritmo rojo": "arcoíris al ritmo",
  "arcoíris al ritmo verde": "arcoíris al ritmo",
  "arcoíris al ritmo azul": "arcoíris al ritmo",
  "colores que corren": "arcoíris",
  "rojo con los graves": "color con los graves",
};

type Doc = Pick<ShowDoc, "instances" | "definitions" | "groups" | "effects" | "moments" | "livePads" | "phonePads" | "controls" | "timelines">;

/**
 * Pone al día los effects del show con el catálogo: los pedazos se cambian
 * por el effect entero (en botones, MIDI y línea de tiempo; en un momento,
 * solo si tenía más de un pedazo: uno suelto era un efecto a medias y sale),
 * y cada grupo con luces recibe los efectos listos que le faltan.
 */
export function catalogUpdate(
  doc: Doc,
  makeId: (prefix: string) => string,
  /** La versión del catálogo con la que ya se puso al día (0: nunca). */
  from = 0,
): Pick<Doc, "effects" | "moments" | "livePads" | "phonePads" | "controls" | "timelines"> | null {
  const now = Date.now();
  const lower = (s: string) => s.toLowerCase();
  let effects = [...doc.effects];
  const replaced = new Map<string, string>();
  const renamed = new Set<string>();
  for (const group of doc.groups) {
    const prefix = lower(`${group.name}: `);
    for (const fx of doc.effects) {
      const old = lower(fx.name).startsWith(prefix) ? lower(fx.name).slice(prefix.length) : "";
      const piece = PIECES[old];
      if (!piece || fx.groupId !== group.id || (fx.kind !== "wave" && !RENAMED.has(old))) continue;
      if (RENAMED.has(old)) renamed.add(fx.id);
      const name = lower(`${group.name}: ${piece}`);
      let whole = effects.find((e) => lower(e.name) === name && e.groupId === group.id);
      const preset = EFFECT_PRESETS.find((p) => lower(p.name) === piece);
      if (!whole && preset) {
        whole = { ...presetEffects(preset, group)[0], id: makeId("effect"), createdAt: now, updatedAt: now };
        effects.push(whole);
      }
      if (whole) replaced.set(fx.id, whole.id);
    }
  }
  effects = effects.filter((fx) => !replaced.has(fx.id));

  const remap = <T extends { action: Action }>(items: T[]) =>
    items.map((item) =>
      item.action.do === "effect" && replaced.has(item.action.id)
        ? { ...item, action: { ...item.action, id: replaced.get(item.action.id)! } }
        : item,
    );
  const moments = doc.moments.map((m) => {
    const pieces = m.effectIds.filter((id) => replaced.has(id));
    if (pieces.length === 0) return m;
    const kept = m.effectIds.filter((id) => !replaced.has(id));
    const wholes = pieces.filter((id) => pieces.length > 1 || renamed.has(id)).map((id) => replaced.get(id)!);
    return { ...m, effectIds: [...new Set([...kept, ...wholes])] };
  });

  // Los nuevos desde la última vez; los que el usuario borró no vuelven.
  const fresh = (name: string) => {
    const preset = name.slice(name.indexOf(": ") + 2);
    return (SINCE[preset] ?? 1) > from;
  };
  const added = missingPresets({ ...doc, effects })
    .filter((d) => fresh(lower(d.name)))
    .map((d) => ({ ...d, id: makeId("effect"), createdAt: now, updatedAt: now }));
  // Sin nada que cambiar no es un paso de Deshacer.
  if (replaced.size === 0 && added.length === 0) return null;
  return {
    effects: [...effects, ...added],
    moments,
    livePads: remap(doc.livePads),
    phonePads: remap(doc.phonePads),
    controls: remap(doc.controls),
    timelines: doc.timelines.map((t) => ({ ...t, cues: remap(t.cues) })),
  };
}

/** Los effects de los efectos listos que le faltan al show, en cada grupo
 *  con luces (uno ya está si hay un effect con su nombre). */
export function missingPresets(show: Rig & { groups: Group[]; effects: { name: string }[] }): EffectDraft[] {
  const names = new Set(show.effects.map((fx) => fx.name.toLowerCase()));
  return show.groups
    .filter((g) => show.instances.some((i) => i.group === g.id))
    .flatMap((g) => presetsFor(show, g.id).map((p) => presetEffects(p, g)))
    .filter((drafts) => !drafts.some((d) => names.has(d.name.toLowerCase())))
    .flat();
}

/** Los effects de ese preset para ese grupo, listos para agregar. */
export function presetEffects(preset: EffectPreset, group: Group): EffectDraft[] {
  return preset.parts.map((part) => ({
    ...BASE,
    ...part.patch,
    name: `${group.name}: ${preset.name.toLowerCase()}`.concat(part.name ? ` ${part.name}` : ""),
    groupId: group.id,
  }));
}
