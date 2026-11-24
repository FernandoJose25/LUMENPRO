import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";
import { ColorSwatches } from "./ColorSwatches";

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

  const withPresets = selectedDefinition.channels.filter((c) => c.presets.length > 0);

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

      <div className="flex max-h-[calc(100%-13rem)] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
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

      <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto scrollbar-thin border-t border-border pt-3">
        <ColorSwatches instances={[selectedInstance]} />
        {withPresets.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-xs font-medium text-text-secondary">{c.name}</span>
            {c.presets.map((p) => (
              <Button
                key={p.id}
                size="sm"
                // El centro del rango: lejos de los bordes, donde los equipos difieren.
                onClick={() => setChannelValue(selectedInstance.id, c.id, Math.round((p.dmxFrom + p.dmxTo) / 2))}
              >
                {p.color ? (
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                ) : null}
                {p.label}
              </Button>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
