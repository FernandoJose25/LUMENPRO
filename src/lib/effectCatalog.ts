import { useEffect } from "react";
import { useFixtureStore } from "@/lib/fixtureStore";
import { CATALOG_VERSION } from "@/lib/effectPresets";
import { readSetting, writeSetting } from "@/lib/settings";

/**
 * Los efectos listos entran solos al show, en cada grupo con luces: la
 * primera vez que hay grupos (al abrir un show que ya los tiene o al usar la
 * plantilla) y cuando el catálogo suma nuevos (CATALOG_VERSION). Los effects
 * viejos que eran un pedazo de otro se cambian por el entero cada vez que
 * abre. No es un paso de Deshacer. Los que el usuario borra no vuelven;
 * "Cargar los que faltan", en Effects, los trae a mano.
 */
export function useEffectCatalog(): void {
  const { engine, groups, instances, updateEffectCatalog } = useFixtureStore();
  const hasGroups = groups.some((g) => instances.some((i) => i.group === g.id));
  useEffect(() => {
    // Con un show que seguía en marcha (la ventana se reabrió) no se toca
    // nada: cambiar sus effects podría cambiar las luces. Va al próximo inicio.
    if (engine.resumed || !hasGroups) return;
    // En cada inicio: los pedazos se juntan siempre (un show importado o un
    // respaldo viejo puede traerlos); los efectos listos nuevos, una vez.
    const from = Math.min(readSetting<number>("effects.catalog") ?? 0, CATALOG_VERSION);
    updateEffectCatalog(from);
    if (from < CATALOG_VERSION) writeSetting("effects.catalog", CATALOG_VERSION);
    // Solo cuando aparecen los grupos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGroups]);
}
