import { useEffect } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { CATALOG_VERSION, missingPresets } from "@/lib/effectPresets";
import { readSetting, writeSetting } from "@/lib/settings";

/**
 * Los efectos listos entran solos al show, en cada grupo con luces: la
 * primera vez que hay grupos (al abrir un show que ya los tiene o al usar la
 * plantilla) y cuando el catálogo crece. Los que el usuario borra después no
 * vuelven; "Cargar los que faltan", en Effects, los trae a mano.
 */
export function useEffectCatalog(): void {
  const { groups, instances, definitions, effects, addEffects } = useFixtureStore();
  const hasGroups = groups.some((g) => instances.some((i) => i.group === g.id));
  useEffect(() => {
    if (!hasGroups || (readSetting<number>("effects.catalog") ?? 0) >= CATALOG_VERSION) return;
    const missing = missingPresets({ groups, instances, definitions, effects });
    if (missing.length > 0) addEffects(missing);
    writeSetting("effects.catalog", CATALOG_VERSION);
    // Solo cuando aparecen los grupos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGroups]);
}
