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
 * Con varias luces elegidas, todo se aplica a todas: los faders van por
 * modelo, porque el mismo valor no significa lo mismo en equipos distintos
 * (el estrobo de una cabeza no es el de un PAR).
 *
 * Los valores en vivo viven en el fixtureStore (no en un useState local):
 * antes se perdían al cambiar de fixture seleccionado, y Scenes (Fase 4)
 * necesita poder capturarlos y recuperarlos desde un solo lugar.
 */
export function FixtureControl({ picker = false }: { picker?: boolean }) {
  const { definitions, instances, selectedInstances, selectInstance, getChannelValue, setChannelValues } =
    useFixtureStore();
  // El Dashboard y Scenes no tienen otra forma de cambiar de luz (en Fixtures
  // se elige en la lista).
  const chooser = picker && instances.length > 1 ? <LightPicker /> : null;

  const models = definitions
    .map((definition) => ({ definition, members: selectedInstances.filter((i) => i.definitionId === definition.id) }))
    .filter((m) => m.members.length > 0);

  if (models.length === 0) {
    return (
      <Panel title="FIXTURE CONTROL" className="h-full">
        {chooser}
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

  const single = selectedInstances.length === 1 ? selectedInstances[0] : null;

  return (
    <Panel className="h-full" title="FIXTURE CONTROL">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {single ? single.label : `${selectedInstances.length} luces`}
          </div>
          <div className="font-mono text-[11px] text-text-secondary">
            {single
              ? `${models[0].definition.channels.length} CHANNELS · U${single.universe} · DMX ${single.address}`
              : models.map((m) => `${m.members.length} × ${m.definition.model}`).join(" · ")}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            title="Cada canal a su valor inicial: posición, color, gobo…"
            onClick={() =>
              setChannelValues(
                Object.fromEntries(
                  models.flatMap(({ definition, members }) =>
                    members.map((i) => [i.id, Object.fromEntries(definition.channels.map((c) => [c.id, c.defaultValue]))]),
                  ),
                ),
              )
            }
          >
            Restablecer valores
          </Button>
          <StatusIndicator status="active" label="Seleccionado" />
        </div>
      </div>

      <div className="flex max-h-[calc(100%-3.5rem)] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
        {chooser}
        <PanTiltPad instances={selectedInstances} />
        <ColorSwatches instances={selectedInstances} />
        <PaletteChips instanceIds={selectedInstances.map((i) => i.id)} />
        {models.map(({ definition, members }) => (
          <section key={definition.id} aria-label={definition.model} className="flex flex-col gap-2.5">
            {models.length > 1 ? (
              <div className="border-t border-border pt-2 text-[11px] font-medium tracking-wide text-text-secondary">
                {definition.model.toUpperCase()} · {members.length}
              </div>
            ) : null}
            {/* Los finos ya van con su canal (el pad, los fades): a mano casi no se usan. */}
            {definition.channels
              .filter((c) => !c.fineOf)
              .map((ch) => {
                const value = getChannelValue(members[0].id, ch.id, ch.defaultValue);
                const set = (v: number) => setChannelValues(Object.fromEntries(members.map((i) => [i.id, { [ch.id]: v }])));
                return (
                  <div key={ch.id} className="flex flex-col gap-1.5">
                    <Fader label={ch.name} value={value} min={ch.dmxMin} max={ch.dmxMax} onChange={set} />
                    {ch.presets.length > 0 ? <ChannelPresets channel={ch} value={value} onPick={set} /> : null}
                  </div>
                );
              })}
          </section>
        ))}
      </div>
    </Panel>
  );
}

/**
 * Las luces a mover. Cada una se prende o apaga de la selección; arriba, de
 * un toque, todas, las de un grupo o las de un modelo (con 100 cabezas no se
 * eligen de a una).
 */
function LightPicker() {
  const { definitions, instances, groups, selectedInstances, selectInstances } = useFixtureStore();
  const chosen = new Set(selectedInstances.map((i) => i.id));
  const idsOf = (keep: (i: (typeof instances)[number]) => boolean) => instances.filter(keep).map((i) => i.id);
  const key = (ids: string[]) => ids.join(",");

  const seen = new Set<string>();
  const sets = [
    { name: "Todas", ids: idsOf(() => true) },
    ...groups.map((g) => ({ name: g.name, ids: idsOf((i) => i.group === g.id) })),
    ...definitions.map((d) => ({ name: d.model, ids: idsOf((i) => i.definitionId === d.id) })),
  ].filter((s) => {
    // Un grupo con las mismas luces que un modelo sale una vez, con su nombre.
    if (s.ids.length < 2 || seen.has(key(s.ids))) return false;
    seen.add(key(s.ids));
    return true;
  });
  const isChosen = (ids: string[]) => ids.length === chosen.size && ids.every((id) => chosen.has(id));

  function toggle(id: string) {
    // Siempre queda al menos una: sin ninguna, el panel no tiene qué mostrar.
    if (chosen.has(id) && chosen.size === 1) return;
    selectInstances(idsOf((i) => (i.id === id ? !chosen.has(id) : chosen.has(i.id))));
  }

  return (
    <div className="flex flex-col gap-1.5">
      {sets.length > 0 ? (
        <div role="group" aria-label="Elegir varias" className="flex flex-wrap gap-1.5">
          {sets.map((s, n) => (
            <Button key={n} size="sm" variant="ghost" selected={isChosen(s.ids)} onClick={() => selectInstances(s.ids)}>
              <span className="max-w-40 truncate">{s.name}</span> ({s.ids.length})
            </Button>
          ))}
        </div>
      ) : null}
      <div role="group" aria-label="Luz a controlar" className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto scrollbar-thin p-1">
        {instances.map((i) => (
          <Button key={i.id} size="sm" selected={chosen.has(i.id)} onClick={() => toggle(i.id)}>
            {i.label}
          </Button>
        ))}
      </div>
      <span className="text-[11px] text-text-secondary">
        Toca varias para moverlas juntas: lo que cambies abajo les llega a todas.
      </span>
    </div>
  );
}
