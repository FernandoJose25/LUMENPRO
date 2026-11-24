import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { useFixtureStore } from "@/lib/fixtureStore";
import { CHANNEL_TYPE_LABELS, type ChannelType, type FixtureChannel } from "@/types/fixture";

const TYPES = Object.keys(CHANNEL_TYPE_LABELS) as ChannelType[];
const SWEEP_MS = 4000; // 0 → 255 → 0
const TICK_MS = 40;

/**
 * Identificar un equipo sin manual: se sube cada canal mirando la luz y se
 * anota qué hace. Los valores no se sueltan al pasar de canal, porque con el
 * dimmer o el shutter cerrados los demás no muestran nada.
 */
export function ChannelFinder({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const { instances, definitions, getChannelValue, setChannelValue, updateDefinition } = useFixtureStore();
  const [sweepingId, setSweepingId] = useState<string | null>(null);

  const setValueRef = useRef(setChannelValue);
  setValueRef.current = setChannelValue;

  // Al parar el barrido el canal vuelve al valor que tenía.
  const beforeSweep = useRef(0);
  useEffect(() => {
    if (!sweepingId) return;
    const before = beforeSweep.current;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const t = ((Date.now() - startedAt) % SWEEP_MS) / SWEEP_MS;
      setValueRef.current(instanceId, sweepingId, Math.round(255 * (t < 0.5 ? t * 2 : 2 - t * 2)));
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      setValueRef.current(instanceId, sweepingId, before);
    };
  }, [instanceId, sweepingId]);

  const instance = instances.find((i) => i.id === instanceId);
  const definition = definitions.find((d) => d.id === instance?.definitionId);
  if (!instance || !definition) return null;

  const valueOf = (c: FixtureChannel) => getChannelValue(instance.id, c.id, c.defaultValue);

  function patch(channelId: string, changes: Partial<FixtureChannel>) {
    updateDefinition({
      ...definition!,
      channels: definition!.channels.map((c) => (c.id === channelId ? { ...c, ...changes } : c)),
    });
  }

  function setType(c: FixtureChannel, type: ChannelType) {
    // Un nombre puesto a mano se respeta.
    const automatic = /^Canal \d+$/.test(c.name) || c.name === CHANNEL_TYPE_LABELS[c.type];
    patch(c.id, { type, ...(automatic ? { name: CHANNEL_TYPE_LABELS[type] } : {}) });
  }

  function addPreset(c: FixtureChannel) {
    const label = window.prompt('Nombre de este valor (por ejemplo "Rojo", "Abierto" o "Estrobo"):')?.trim();
    if (!label) return;
    const value = valueOf(c);
    patch(c.id, {
      presets: [...c.presets, { id: `pr-${crypto.randomUUID()}`, label, dmxFrom: value, dmxTo: value }],
    });
  }

  function toggleSweep(c: FixtureChannel) {
    if (sweepingId === c.id) return setSweepingId(null);
    beforeSweep.current = valueOf(c);
    setSweepingId(c.id);
  }

  return (
    <Panel title={`IDENTIFICAR CANALES — ${instance.label}`}>
      <div className="mb-3 flex items-start gap-3">
        <p className="flex-1 text-xs text-text-secondary">
          Pulsa <b className="text-text-primary">Barrer</b> en un canal, mira la luz y elige qué hace. Busca primero
          el dimmer y el estrobo y déjalos arriba: con la luz cerrada los demás no se notan. Si uno reinicia la
          luz o apaga la lámpara, es el de funciones especiales: déjalo en 0. Vale para todas las unidades de{" "}
          {definition.model}.
        </p>
        <Button onClick={onClose}>Listo</Button>
      </div>
      <div className="flex flex-col gap-2">
        {definition.channels.map((c) => (
          <div key={c.id} className="rounded-control border border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-24 shrink-0 font-mono text-[11px] text-text-secondary">
                {c.index} · DMX {instance.address + c.index - 1}
              </span>
              <div className="min-w-0 flex-1">
                <Fader
                  label={`Canal ${c.index}`}
                  value={valueOf(c)}
                  onChange={(v) => {
                    setSweepingId((id) => (id === c.id ? null : id));
                    setChannelValue(instance.id, c.id, v);
                  }}
                />
              </div>
              <Button
                size="sm"
                variant={sweepingId === c.id ? "danger" : "secondary"}
                aria-label={`Barrer canal ${c.index}`}
                onClick={() => toggleSweep(c)}
              >
                {sweepingId === c.id ? "Parar" : "Barrer"}
              </Button>
              <select
                aria-label={`Función del canal ${c.index}`}
                value={c.type}
                onChange={(e) => setType(c, e.target.value as ChannelType)}
                className="h-7 rounded-control border border-border bg-panel2 px-1.5 text-xs text-text-primary outline-none"
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CHANNEL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Usar como valor inicial del canal ${c.index}`}
                title="El valor que toma si ninguna escena lo define"
                disabled={c.defaultValue === valueOf(c)}
                onClick={() => patch(c.id, { defaultValue: valueOf(c) })}
              >
                Inicial: {c.defaultValue}
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Guardar preset del canal ${c.index}`} onClick={() => addPreset(c)}>
                + Preset
              </Button>
            </div>
            {c.presets.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-text-secondary">
                {c.presets.map((p) => (
                  <span key={p.id} className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
                    {c.type === "COLOR_WHEEL" ? (
                      <input
                        type="color"
                        aria-label={`Color de ${p.label}`}
                        title="Color con el que se ve en el simulador"
                        value={p.color ?? "#ffffff"}
                        onChange={(e) =>
                          patch(c.id, {
                            presets: c.presets.map((o) => (o.id === p.id ? { ...o, color: e.target.value } : o)),
                          })
                        }
                        className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                      />
                    ) : null}
                    {p.label} <span className="font-mono">{p.dmxFrom === p.dmxTo ? p.dmxFrom : `${p.dmxFrom}–${p.dmxTo}`}</span>
                    <button
                      type="button"
                      aria-label={`Borrar preset ${p.label}`}
                      className="hover:text-state-danger"
                      onClick={() => patch(c.id, { presets: c.presets.filter((o) => o.id !== p.id) })}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
