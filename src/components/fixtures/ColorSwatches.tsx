import { colorValues, lookValues, SWATCHES, takesColor } from "@/lib/look";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { FixtureInstance } from "@/types/fixture";

/** Colores de un toque para los equipos que puedan ponerlos (LED, CMY o rueda
 *  de color); si no hay ninguno, no se muestra. */
export function ColorSwatches({ instances }: { instances: FixtureInstance[] }) {
  const { definitions, getChannelValue, setChannelValues } = useFixtureStore();
  const definitionOf = (i: FixtureInstance) => definitions.find((d) => d.id === i.definitionId);
  const channelsOf = (i: FixtureInstance) => definitionOf(i)?.channels ?? [];
  const colorable = instances.filter((i) => {
    const definition = definitionOf(i);
    return definition && takesColor(definition);
  });
  if (colorable.length === 0) return null;

  function pick(hex: string) {
    // Con el dimmer en 0 el color no se vería: se sube solo en los apagados.
    const dark = colorable.filter((i) =>
      channelsOf(i).some((c) => c.type === "DIMMER" && getChannelValue(i.id, c.id, c.defaultValue) === 0),
    );
    setChannelValues(lookValues(dark, definitions, { DIMMER: 255 }));
    setChannelValues(Object.fromEntries(colorable.map((i) => [i.id, colorValues(definitionOf(i)!, hex)])));
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {SWATCHES.map(({ name, hex }) => (
        <button
          key={name}
          type="button"
          aria-label={name}
          title={name}
          onClick={() => pick(hex)}
          className="h-8 w-8 rounded-control border border-border hover:scale-110"
          style={{ backgroundColor: hex }}
        />
      ))}
      <input
        type="color"
        aria-label="Otro color"
        title="Otro color"
        onChange={(e) => pick(e.target.value)}
        className="h-8 w-10 cursor-pointer rounded-control border border-border bg-panel2"
      />
    </div>
  );
}
