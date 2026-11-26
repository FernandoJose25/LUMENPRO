import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";
import { ColorSwatches } from "./ColorSwatches";
import { PaletteChips } from "@/components/palettes/PalettesView";
import { ChannelPresets } from "./ChannelPresets";
import { PanTiltPad } from "./PanTiltPad";

/**
 * Sección 7: "Cuando se selecciona un fixture, el panel debe adaptarse a
 * sus capacidades" — los canales vienen del perfil real (Fixture Editor),
 * no están hardcodeados. Las cabezas tienen además un pad para apuntar.
 *
 * Los valores en vivo viven en el fixtureStore (no en un useState local):
 * antes se perdían al cambiar de fixture seleccionado, y Scenes (Fase 4)
 * necesita poder capturarlos y recuperarlos desde un solo lugar.
 */
export function FixtureControl() {
  const {
    selectedInstance,
    selectedDefinition,
    instances,
    selectInstance,
    getChannelValue,
    setChannelValue,
    setChannelValues,
  } = useFixtureStore();

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

  // Los finos ya van con su canal (el pad, los fades): a mano casi no se usan.
  const faders = selectedDefinition.channels.filter((c) => !c.fineOf);

  return (
    <Panel className="h-full" title="FIXTURE CONTROL">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-text-primary">{selectedInstance.label}</div>
          <div className="font-mono text-[11px] text-text-secondary">
            {selectedDefinition.channels.length} CHANNELS · U{selectedInstance.universe} · DMX {selectedInstance.address}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            title="Cada canal a su valor inicial: posición, color, gobo…"
            onClick={() =>
              setChannelValues({
                [selectedInstance.id]: Object.fromEntries(selectedDefinition.channels.map((c) => [c.id, c.defaultValue])),
              })
            }
          >
            Restablecer valores
          </Button>
          <StatusIndicator status="active" label="Seleccionado" />
        </div>
      </div>

      <div className="flex max-h-[calc(100%-3.5rem)] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
        <PanTiltPad instances={[selectedInstance]} />
        <ColorSwatches instances={[selectedInstance]} />
        <PaletteChips instanceIds={[selectedInstance.id]} />
        {faders.map((ch) => {
          const value = getChannelValue(selectedInstance.id, ch.id, ch.defaultValue);
          const set = (v: number) => setChannelValue(selectedInstance.id, ch.id, v);
          return (
            <div key={ch.id} className="flex flex-col gap-1.5">
              <Fader label={ch.name} value={value} min={ch.dmxMin} max={ch.dmxMax} onChange={set} />
              {ch.presets.length > 0 ? <ChannelPresets channel={ch} value={value} onPick={set} /> : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
