import { useEffect } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { CATALOG_VERSION } from "@/lib/effectPresets";
import { readSetting, writeSetting } from "@/lib/settings";

/**
 * Los efectos listos entran solos al show, en cada grupo con luces: la
 * primera vez que hay grupos (al abrir un show que ya los tiene o al usar la
 * plantilla) y cada vez que el catálogo cambia (CATALOG_VERSION), que además
 * cambia los effects viejos que eran un pedazo de otro por el entero. Los que
 * el usuario borra después no vuelven; "Cargar los que faltan", en Effects,
 * los trae a mano.
 */
export function useEffectCatalog(): void {
  const { engine, groups, instances, updateEffectCatalog } = useFixtureStore();
  const hasGroups = groups.some((g) => instances.some((i) => i.group === g.id));
  useEffect(() => {
    // Con un show que seguía en marcha (la ventana se reabrió) no se toca
    // nada: cambiar sus effects podría cambiar las luces. Va al próximo inicio.
    if (engine.resumed || !hasGroups || (readSetting<number>("effects.catalog") ?? 0) >= CATALOG_VERSION) return;
    updateEffectCatalog();
    writeSetting("effects.catalog", CATALOG_VERSION);
    // Solo cuando aparecen los grupos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGroups]);
}
