import { Panel } from "@/components/ui/Panel";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";

/**
 * Visualizer 2D — primera versión funcional, reemplaza el placeholder
 * vacío (ver PASOS-PENDIENTES.md). Ahora que Scenes/Chases/Effects
 * escriben en `liveValues` de verdad, este panel tiene algo real que
 * mostrar: cada fixture es un punto de luz cuyo color y brillo reflejan
 * sus canales EN VIVO, no un mockup estático.
 *
 * Alcance deliberadamente acotado por ahora: layout automático (ordenado
 * por dirección DMX, en fila/grid), no posicionamiento manual tipo
 * "planta del escenario" — eso es 3D/edición de posición y queda para
 * una iteración posterior (ver nota al final del panel).
 */
export function StageVisualizer() {
  const { instances, definitions, getChannelValue, groups } = useFixtureStore();

  const sorted = [...instances].sort((a, b) => a.address - b.address);

  return (
    <Panel title="VISUALIZER 2D" className="h-full">
      {sorted.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          No hay fixtures en el rig todavía — agrégalos en Fixtures.
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-6 rounded-control bg-[#0a0a0f] p-4">
            {sorted.map((instance) => {
              const def = definitions.find((d) => d.id === instance.definitionId);
              if (!def) return null;
              const group = groups.find((g) => g.id === instance.group) ?? null;
              return (
                <FixtureLight
                  key={instance.id}
                  instance={instance}
                  definition={def}
                  getChannelValue={getChannelValue}
                  groupColor={group?.color ?? null}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-text-secondary">
            Color y brillo en vivo (Dimmer + RGB si el fixture los tiene). Layout automático por
            dirección DMX — posicionamiento manual tipo planta de escenario y vista 3D quedan
            pendientes, ver PASOS-PENDIENTES.md.
          </p>
        </div>
      )}
    </Panel>
  );
}

function FixtureLight({
  instance,
  definition,
  getChannelValue,
  groupColor,
}: {
  instance: FixtureInstance;
  definition: FixtureDefinition;
  getChannelValue: (instanceId: string, channelId: string, fallback: number) => number;
  groupColor: string | null;
}) {
  const find = (type: string) => definition.channels.find((c) => c.type === type);
  const dimmerCh = find("DIMMER");
  const redCh = find("RED");
  const greenCh = find("GREEN");
  const blueCh = find("BLUE");

  // Si el fixture no tiene canal Dimmer (algunos PARs solo tienen Master
  // Dimmer en RGB, otros ninguno), se asume siempre "encendido" a full —
  // no hay forma de saber su brillo real sin ese canal.
  const dimmer = dimmerCh ? getChannelValue(instance.id, dimmerCh.id, dimmerCh.defaultValue) : 255;

  const hasRgb = redCh || greenCh || blueCh;
  const r = redCh ? getChannelValue(instance.id, redCh.id, redCh.defaultValue) : 255;
  const g = greenCh ? getChannelValue(instance.id, greenCh.id, greenCh.defaultValue) : 255;
  const b = blueCh ? getChannelValue(instance.id, blueCh.id, blueCh.defaultValue) : 255;
  // Sin canales RGB (p. ej. un cabeza móvil solo blanco), el "color" es
  // blanco puro modulado por el dimmer — sigue siendo visualmente honesto.
  const color = hasRgb ? `rgb(${r}, ${g}, ${b})` : "rgb(255, 255, 255)";

  const brightness = dimmer / 255;
  // Piso mínimo de opacidad para que un fixture "apagado" siga siendo
  // visible como un punto tenue en vez de desaparecer del todo — más útil
  // para ver el layout completo del rig de un vistazo.
  const opacity = 0.12 + brightness * 0.88;
  const glowSize = 8 + brightness * 22;

  return (
    <div className="flex flex-col items-center gap-1.5" title={`${instance.label} · DMX ${instance.address}`}>
      <div
        className="h-8 w-8 rounded-full transition-[box-shadow,background-color] duration-150"
        style={{
          backgroundColor: color,
          opacity,
          boxShadow: `0 0 ${glowSize}px ${glowSize / 2}px ${color}`,
          border: groupColor ? `2px solid ${groupColor}` : "2px solid transparent",
        }}
      />
      <span className="max-w-[72px] truncate text-[10px] text-text-secondary">{instance.label}</span>
    </div>
  );
}
