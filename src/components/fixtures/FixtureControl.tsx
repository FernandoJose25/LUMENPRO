import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureChannel } from "@/types/fixture";

/**
 * Sección 7: "Cuando se selecciona un fixture, el panel debe adaptarse a
 * sus capacidades" — los canales vienen del perfil real (Fixture Editor),
 * no están hardcodeados. Pan/Tilt como joystick XY (recomendado en la
 * tabla de la sección 7) queda para una iteración posterior — aquí todos
 * los canales usan Fader, que ya soporta drag/wheel/teclado/numérico.
 *
 * Los valores en vivo viven en el fixtureStore (no en un useState local):
 * antes se perdían al cambiar de fixture seleccionado, y Scenes (Fase 4)
 * necesita poder capturarlos y recuperarlos desde un solo lugar.
 */
export function FixtureControl() {
  const { selectedInstance, selectedDefinition, instances, selectInstance, getChannelValue, setChannelValue } =
    useFixtureStore();

  if (!selectedInstance || !selectedDefinition) {
    return (
      <Panel title="FIXTURE CONTROL" className="h-full">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-text-secondary">
          <span>Ningún fixture seleccionado.</span>
          {instances[0] ? (
            <Button size="sm" variant="secondary" onClick={() => selectInstance(instances[0].id)}>
              Seleccionar {instances[0].label}
            </Button>
          ) : null}
        </div>
      </Panel>
    );
  }

  const quickBar = getQuickBar(selectedDefinition.channels);

  return (
    <Panel className="h-full" title="FIXTURE CONTROL">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-text-primary">{selectedInstance.label}</div>
          <div className="font-mono text-[11px] text-text-secondary">
            {selectedDefinition.channels.length} CHANNELS · U{selectedInstance.universe} · DMX {selectedInstance.address}
          </div>
        </div>
        <StatusIndicator status="active" label="Seleccionado" />
      </div>

      <div className="flex max-h-[calc(100%-9rem)] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
        {selectedDefinition.channels.map((ch) => (
          <Fader
            key={ch.id}
            label={ch.name}
            value={getChannelValue(selectedInstance.id, ch.id, ch.defaultValue)}
            min={ch.dmxMin}
            max={ch.dmxMax}
            onChange={(v) => setChannelValue(selectedInstance.id, ch.id, v)}
          />
        ))}
      </div>

      {quickBar.length ? (
        <div className="mt-3 grid grid-cols-4 gap-1.5 border-t border-border pt-3">
          {quickBar.map((label) => (
            <Button key={label} size="sm" variant="secondary">
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

/** Sección 8 — "mostrar únicamente las funciones relevantes" según el tipo de fixture. */
function getQuickBar(channels: FixtureChannel[]): string[] {
  const types = new Set(channels.map((c) => c.type));
  const isRgbPar = types.has("RED") && types.has("GREEN") && types.has("BLUE");

  if (isRgbPar) {
    return ["RGB", "DIMMER", "STROBE", "MACROS"];
  }

  const beamButtons: string[] = [];
  if (types.has("COLOR") || types.has("COLOR_WHEEL")) beamButtons.push("WHITE", "COLOR");
  if (types.has("GOBO")) beamButtons.push("GOBO");
  if (types.has("PRISM")) beamButtons.push("PRISM");
  if (types.has("FROST")) beamButtons.push("FROST");
  if (types.has("ZOOM")) beamButtons.push("ZOOM");
  if (types.has("FOCUS")) beamButtons.push("FOCUS");
  if (types.has("STROBE")) beamButtons.push("STROBE");
  return beamButtons;
}
