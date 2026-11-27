import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { cn } from "@/lib/utils";
import { askConfirm } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import { factoryEffect } from "@/lib/factory";
import { SWATCHES } from "@/lib/look";
import {
  EFFECT_SOURCE_LABELS,
  PIXEL_USES_COLOR,
  PIXEL_USES_COLOR2,
  type Effect,
  type EffectSource,
} from "@/types/effect";
import { CHANNEL_TYPE_LABELS, COLOR_CHANNEL_TYPES } from "@/types/fixture";

const BEATS = [0.5, 1, 2, 4, 8];

/**
 * Los ajustes de un effect a mano: sus colores, la velocidad o el ritmo y el
 * tamaño de una figura. Lo que se cambia llega a las luces al instante (si
 * está prendido); sin tocar nada queda como venía.
 */
export function EffectSettings({
  effect,
  running,
  heldColors,
  onToggle,
  onReleaseHeld,
}: {
  effect: Effect;
  running: boolean;
  /** Los colores fijos de donde se mira (las luces o la vista previa). */
  heldColors: Record<string, string>;
  onToggle: () => void;
  /** Suelta el color fijo del grupo del effect. */
  onReleaseHeld: () => void;
}) {
  const store = useFixtureStore();
  const { updateEffect, groups } = store;
  const group = groups.find((g) => g.id === effect.groupId);
  const held = effect.groupId ? heldColors[effect.groupId] : undefined;
  const heldName = SWATCHES.find((s) => s.hex === held)?.name.toLowerCase();
  const factory = factoryEffect(store, effect);

  // Un color elegido aquí tiene que verse: el color fijo del grupo lo taparía.
  function paint(patch: Partial<Effect>) {
    updateEffect(effect.id, patch);
    if (held) onReleaseHeld();
  }

  const pixels = effect.kind === "pixels";
  const pattern = effect.pattern ?? "rainbow";
  const ownColors = pixels && !PIXEL_USES_COLOR.includes(pattern);
  const waveOnColor = effect.kind === "wave" && COLOR_CHANNEL_TYPES.includes(effect.channelType);

  return (
    <section aria-label={`Ajustes de ${effect.name}`} className="flex flex-col gap-3 text-xs text-text-secondary">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{effect.name}</span>
        <Button size="sm" variant={running ? "danger" : "primary"} disabled={!effect.groupId} onClick={onToggle}>
          {running ? "■ Apagar" : "▶ Prender"}
        </Button>
      </div>

      {held && (pixels || effect.color) ? (
        <p className="rounded-control border border-accent/40 bg-accent/10 p-2 text-[11px] text-text-primary">
          El Color fijo de {group?.name ?? "este grupo"} ({heldName}) está pintando este efecto. Si eliges un color aquí,
          se suelta.
        </p>
      ) : null}

      {pixels && !ownColors ? (
        <ColorPicker label="Color" value={effect.color ?? "#ffffff"} onPick={(color) => paint({ color })} />
      ) : null}
      {pixels && PIXEL_USES_COLOR2.includes(pattern) ? (
        <ColorPicker
          label="Segundo color"
          value={effect.color2 ?? null}
          noneLabel="Apagado"
          onPick={(color2) => paint({ color2 })}
        />
      ) : null}
      {ownColors ? <p>Trae sus propios colores. Con el Color fijo lo pasas a uno solo.</p> : null}
      {effect.kind === "wave" && !waveOnColor ? (
        <ColorPicker
          label="Color"
          value={effect.color ?? null}
          noneLabel="Del momento"
          onPick={(color) => paint({ color })}
        />
      ) : null}
      {waveOnColor ? (
        <p>
          Mueve solo el canal {CHANNEL_TYPE_LABELS[effect.channelType]}. Para elegir el color, usa un efecto de la sección
          Colores.
        </p>
      ) : null}

      {effect.kind === "figure" ? (
        <Fader
          label="Tamaño"
          value={effect.sizeDeg}
          min={2}
          max={90}
          unit="°"
          onChange={(sizeDeg) => updateEffect(effect.id, { sizeDeg })}
        />
      ) : null}

      <label className="flex flex-col gap-1">
        Sigue a
        <select
          value={effect.source}
          onChange={(e) => updateEffect(effect.id, { source: e.target.value as EffectSource })}
          className="h-8 rounded-control border border-border bg-panel2 px-2 text-text-primary"
        >
          {(Object.keys(EFFECT_SOURCE_LABELS) as EffectSource[]).map((s) => (
            <option key={s} value={s}>
              {EFFECT_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {effect.source === "clock" ? (
        <Fader
          label="Velocidad (vueltas por minuto)"
          value={effect.speedCpm}
          min={1}
          max={600}
          onChange={(speedCpm) => updateEffect(effect.id, { speedCpm: Math.max(1, speedCpm) })}
        />
      ) : effect.source === "beat" ? (
        <div className="flex flex-col gap-1">
          Una vuelta cada
          <div className="flex gap-1">
            {BEATS.map((beats) => (
              <Button
                key={beats}
                size="sm"
                selected={effect.beatsPerCycle === beats}
                aria-pressed={effect.beatsPerCycle === beats}
                onClick={() => updateEffect(effect.id, { beatsPerCycle: beats })}
              >
                {beats === 0.5 ? "½" : beats} {beats > 1 ? "golpes" : "golpe"}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <p>Va con lo que suena: sin música queda en su mínimo.</p>
      )}

      {factory ? (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => askConfirm(`¿Restablecer "${effect.name}" a como venía?`, "Restablecer", () => updateEffect(effect.id, factory))}
        >
          Restablecer
        </Button>
      ) : null}
    </section>
  );
}

/** Los colores de un toque, uno a medida y, si se puede, ninguno. */
function ColorPicker({
  label,
  value,
  noneLabel,
  onPick,
}: {
  label: string;
  value: string | null;
  /** Con esto, un botón para no poner color. */
  noneLabel?: string;
  onPick: (hex: string | null) => void;
}) {
  const current = value?.toLowerCase() ?? null;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {noneLabel ? (
          <Button size="sm" selected={current === null} aria-pressed={current === null} onClick={() => onPick(null)}>
            {noneLabel}
          </Button>
        ) : null}
        {SWATCHES.map(({ name, hex }) => (
          <button
            key={hex}
            type="button"
            aria-label={`${label}: ${name}`}
            aria-pressed={current === hex}
            title={name}
            onClick={() => onPick(hex)}
            className={cn(
              "h-7 w-7 rounded-control border hover:scale-110",
              current === hex ? "border-text-primary ring-2 ring-accent" : "border-border",
            )}
            style={{ backgroundColor: hex }}
          />
        ))}
        <input
          type="color"
          aria-label={`${label}: otro`}
          title="Otro color"
          value={current ?? "#000000"}
          onChange={(e) => onPick(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded-control border border-border bg-panel2"
        />
      </div>
    </fieldset>
  );
}
