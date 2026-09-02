import { ScenesPanel } from "@/components/scenes/ScenesPanel";
import { FixtureControl } from "@/components/fixtures/FixtureControl";

/**
 * La entrada "Scenes" del Sidebar apuntaba a PlaceholderView aunque la
 * lógica de escenas ya existe (ver components/scenes/ScenesPanel.tsx,
 * usado desde el Dashboard). Esta vista es esa misma lógica con más
 * espacio dedicado, más FixtureControl al lado para poder capturar
 * valores sin tener que ir al Dashboard primero.
 */
export function ScenesView() {
  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="min-w-0 flex-1">
        <ScenesPanel />
      </div>
      <div className="w-[380px] shrink-0">
        <FixtureControl />
      </div>
    </div>
  );
}
