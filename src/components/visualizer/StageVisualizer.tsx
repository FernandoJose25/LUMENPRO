import { Panel } from "@/components/ui/Panel";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { useFixtureStore } from "@/lib/fixtureStore";

/** El simulador en el Dashboard, solo para mirar. Las posiciones se editan en
 *  la sección Escenario. */
export function StageVisualizer() {
  const store = useFixtureStore();

  return (
    <Panel title="SIMULADOR" className="h-full">
      {store.instances.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          No hay fixtures en el rig todavía — agrégalos en Fixtures.
        </div>
      ) : (
        <StageCanvas rig={store} />
      )}
    </Panel>
  );
}
