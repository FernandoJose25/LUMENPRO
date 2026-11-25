import { Button } from "@/components/ui/Button";
import { goboUrl } from "@/lib/library";
import type { ChannelPreset, FixtureChannel } from "@/types/fixture";

/** Con más que esto, una lista desplegable se usa mejor que una pared de
 *  botones. Colores y gobos se eligen mirando: siempre botones. */
const MAX_BUTTONS = 8;

// El centro del rango: lejos de los bordes, donde los equipos difieren.
const middle = (p: ChannelPreset) => Math.round((p.dmxFrom + p.dmxTo) / 2);

/** Las funciones de un canal, por su nombre. */
export function ChannelPresets({
  channel,
  value,
  onPick,
}: {
  channel: FixtureChannel;
  value: number;
  onPick: (value: number) => void;
}) {
  const current = channel.presets.find((p) => value >= p.dmxFrom && value <= p.dmxTo);
  const visual = channel.presets.some((p) => p.color || p.gobo);
  // Reiniciar el equipo o apagar la lámpara no puede quedar a un toque.
  const risky = channel.presets.some((p) => p.kind === "reset" || p.kind === "lamp");

  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-4">
      {!risky && (visual || channel.presets.length <= MAX_BUTTONS) ? (
        channel.presets.map((p) => (
          <Button
            key={p.id}
            size="sm"
            selected={p === current}
            title={`${p.label} (${p.dmxFrom}–${p.dmxTo})`}
            onClick={() => onPick(middle(p))}
          >
            <PresetIcon preset={p} />
            <span className="max-w-32 truncate">{p.label}</span>
          </Button>
        ))
      ) : (
        <select
          aria-label={`Función de ${channel.name}`}
          value={current?.id ?? ""}
          onChange={(e) => {
            const preset = channel.presets.find((p) => p.id === e.target.value);
            if (preset) onPick(middle(preset));
          }}
          className="h-7 min-w-0 flex-1 rounded-control border border-border bg-panel2 px-1.5 text-xs text-text-primary outline-none"
        >
          {current ? null : <option value="">—</option>}
          {channel.presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.dmxFrom}–{p.dmxTo} · {p.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function PresetIcon({ preset }: { preset: ChannelPreset }) {
  if (preset.gobo) {
    // Los gobos son máscaras: lo transparente es por donde pasa la luz.
    return <img src={goboUrl(preset.gobo)} alt="" loading="lazy" className="h-5 w-5 rounded-full bg-white" />;
  }
  if (!preset.color) return null;
  const background = preset.color2
    ? `linear-gradient(90deg, ${preset.color} 50%, ${preset.color2} 50%)`
    : preset.color;
  return <span className="h-3 w-3 shrink-0 rounded-full" style={{ background }} aria-hidden />;
}
