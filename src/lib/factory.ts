import { seedDefinitions } from "@/data/fixtureLibrary";
import { buildQuinceTemplate } from "@/data/quinceTemplate";
import { EFFECT_PRESETS, presetEffects, type EffectDraft } from "@/lib/effectPresets";
import type { ShowDoc } from "@/lib/history";
import { loadDefinition, loadLibrary } from "@/lib/library";
import type { Effect } from "@/types/effect";
import type { FixtureDefinition } from "@/types/fixture";

/**
 * "Restablecer": cómo venía cada cosa antes de tocarla. Lo que venía de la
 * plantilla o de los efectos listos se reconoce por el nombre; lo que armó el
 * usuario de cero no tiene a qué volver.
 */

/** Un effect como lo arma la plantilla o un efecto listo, o null. */
export function factoryEffect(doc: ShowDoc, effect: Effect): EffectDraft | null {
  const template = buildQuinceTemplate(doc, (prefix) => prefix).effects;
  const presets = doc.groups.flatMap((group) => EFFECT_PRESETS.flatMap((p) => presetEffects(p, group)));
  const found = [...template, ...presets].find((fx) => fx.name === effect.name);
  if (!found) return null;
  const { id: _id, createdAt: _created, updatedAt: _updated, name: _name, groupId: _group, ...rest } = found as Effect;
  return { ...rest, name: effect.name, groupId: effect.groupId };
}

/**
 * La plantilla de quinceañera otra vez: sus momentos, escenas y effects
 * vuelven a como los arma, conservando sus ids (los botones de Live, del
 * celular y del MIDI siguen andando). Lo que creó el usuario no se toca.
 */
export function resetTemplate(doc: ShowDoc, makeId: (prefix: string) => string): Partial<ShowDoc> {
  const t = buildQuinceTemplate(doc, makeId);
  const oldMoment = (name: string) => doc.moments.find((m) => m.name === name);
  const effectIds = new Map(t.effects.map((fx) => [fx.id, doc.effects.find((o) => o.name === fx.name)?.id ?? fx.id]));
  const sceneIds = new Map(
    t.moments.map((m) => [m.sceneId!, oldMoment(m.name)?.sceneId ?? m.sceneId!] as const),
  );
  const moments = t.moments.map((m) => ({
    ...m,
    id: oldMoment(m.name)?.id ?? m.id,
    sceneId: sceneIds.get(m.sceneId!) ?? m.sceneId,
    effectIds: m.effectIds.map((id) => effectIds.get(id) ?? id),
  }));
  const scenes = t.scenes.map((s) => ({ ...s, id: sceneIds.get(s.id) ?? s.id }));
  const effects = t.effects.map((fx) => ({ ...fx, id: effectIds.get(fx.id) ?? fx.id }));

  // Cada uno en su lugar; los que faltaban, al final.
  const merge = <T extends { id: string }>(old: T[], fresh: T[]) => [
    ...old.map((o) => fresh.find((f) => f.id === o.id) ?? o),
    ...fresh.filter((f) => !old.some((o) => o.id === f.id)),
  ];
  return {
    instances: t.instances,
    groups: t.groups,
    scenes: merge(doc.scenes, scenes),
    effects: merge(doc.effects, effects),
    moments: merge(doc.moments, moments),
  };
}

/** El perfil como viene de fábrica (biblioteca o equipos de ejemplo), con el
 *  mismo id: las luces y escenas que lo usan siguen valiendo. */
export async function factoryDefinition(definition: FixtureDefinition): Promise<FixtureDefinition | null> {
  const seed = seedDefinitions.find((d) => d.id === definition.id);
  if (seed) return structuredClone(seed);
  const { library, mode } = definition;
  if (!library || !mode) return null;
  const entry = (await loadLibrary()).find((e) => e.maker === library.maker && e.model === library.model);
  if (!entry) return null;
  return { ...(await loadDefinition(entry, mode)), id: definition.id };
}

export const hasFactoryDefinition = (definition: FixtureDefinition) =>
  seedDefinitions.some((d) => d.id === definition.id) || (definition.library !== undefined && definition.mode !== undefined);
