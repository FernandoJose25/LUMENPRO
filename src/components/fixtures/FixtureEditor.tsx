import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { acceptsCurve } from "@/lib/dmxFrame";
import { CHANNEL_TYPE_LABELS, type ChannelType, type FixtureChannel, type FixtureDefinition } from "@/types/fixture";

interface FixtureEditorProps {
  definition: FixtureDefinition | null;
  onSave: (def: FixtureDefinition) => void;
  onCancel: () => void;
}

const CHANNEL_TYPES = Object.keys(CHANNEL_TYPE_LABELS) as ChannelType[];
const CURVE_LABELS: Record<FixtureChannel["curve"], string> = {
  linear: "Lineal",
  log: "Suave al encender",
  "s-curve": "Suave en los extremos",
};
const CURVES = Object.keys(CURVE_LABELS) as FixtureChannel["curve"][];

export function emptyChannel(index: number): FixtureChannel {
  return {
    id: `ch-${crypto.randomUUID()}`,
    index,
    name: "",
    type: "OTHER",
    dmxMin: 0,
    dmxMax: 255,
    defaultValue: 0,
    invert: false,
    curve: "linear",
    presets: [],
  };
}

/**
 * Sección 10 — "Debe ser posible crear fixtures manualmente sin depender
 * de una biblioteca online." Tabla CHANNEL/ATTRIBUTE editable con nombre,
 * tipo, rango DMX, presets, inversión, curvas y funciones especiales.
 */
export function FixtureEditor({ definition, onSave, onCancel }: FixtureEditorProps) {
  const isNew = definition === null;
  const [manufacturer, setManufacturer] = useState(definition?.manufacturer ?? "");
  const [model, setModel] = useState(definition?.model ?? "");
  const [channels, setChannels] = useState<FixtureChannel[]>(
    definition?.channels ?? [emptyChannel(1)],
  );

  const updateChannel = (id: string, patch: Partial<FixtureChannel>) => {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeChannel = (id: string) => {
    setChannels((cs) => {
      const removed = cs.find((c) => c.id === id)!.index;
      return cs
        .filter((c) => c.id !== id)
        .map((c) => (c.index > removed ? { ...c, index: c.index - 1 } : c));
    });
  };

  const addChannel = () => {
    setChannels((cs) => [...cs, emptyChannel(Math.max(0, ...cs.map((c) => c.index)) + 1)]);
  };

  const repeated = channels.find((c) => channels.some((o) => o !== c && o.index === c.index));
  const canSave =
    manufacturer.trim() && model.trim() && channels.every((c) => c.name.trim() && c.index >= 1) && !repeated;

  const handleSave = () => {
    onSave({
      id: definition?.id ?? `def-${crypto.randomUUID()}`,
      manufacturer: manufacturer.trim(),
      model: model.trim(),
      channels: [...channels].sort((a, b) => a.index - b.index),
      panLimit: definition?.panLimit,
      tiltLimit: definition?.tiltLimit,
      verified: definition?.verified ?? false,
      verifiedNote: isNew
        ? "Creado manualmente en Fixture Editor — verifícalo contra la hoja del fabricante antes de un show en vivo."
        : definition?.verifiedNote,
    });
  };

  return (
    <Panel title={isNew ? "FIXTURE EDITOR — NUEVO" : `FIXTURE EDITOR — ${model.toUpperCase()}`} className="h-full">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Manufacturer
          <input
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            className="rounded-control border border-border bg-panel2 px-2 py-1.5 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-text-secondary">
          Model
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-control border border-border bg-panel2 px-2 py-1.5 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        </label>
      </div>

      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full min-w-[860px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-panel2 text-left text-text-secondary">
              <th className="px-2 py-1.5 font-medium">CH</th>
              <th className="px-2 py-1.5 font-medium">ATTRIBUTE (nombre)</th>
              <th className="px-2 py-1.5 font-medium">Tipo</th>
              <th className="px-2 py-1.5 font-medium">Min</th>
              <th className="px-2 py-1.5 font-medium">Max</th>
              <th className="px-2 py-1.5 font-medium">Default</th>
              <th className="px-2 py-1.5 font-medium">Curva</th>
              <th className="px-2 py-1.5 font-medium">Invertir</th>
              <th className="px-2 py-1.5 font-medium">Notas / funciones especiales</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.id} className="border-b border-border last:border-0 hover:bg-panel2/50">
                <td className="px-2 py-1.5">
                  {/* Cambiar el número mueve la función entera: las escenas
                      guardan el id del canal, no su posición. */}
                  <input
                    type="number"
                    min={1}
                    max={512}
                    aria-label={`Número de canal de ${ch.name}`}
                    value={ch.index || ""}
                    onChange={(e) => updateChannel(ch.id, { index: Number(e.target.value) })}
                    className="w-12 rounded border border-border bg-panel2 px-1 py-1 text-center font-mono text-text-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={ch.name}
                    onChange={(e) => updateChannel(ch.id, { name: e.target.value })}
                    placeholder="p. ej. Pan"
                    className="w-full min-w-[110px] rounded border border-border bg-panel2 px-1.5 py-1 text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    value={ch.type}
                    onChange={(e) => updateChannel(ch.id, { type: e.target.value as ChannelType })}
                    className="rounded border border-border bg-panel2 px-1.5 py-1 text-text-primary outline-none"
                  >
                    {CHANNEL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {CHANNEL_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={ch.dmxMin}
                    onChange={(e) => updateChannel(ch.id, { dmxMin: Number(e.target.value) })}
                    className="w-14 rounded border border-border bg-panel2 px-1.5 py-1 text-center font-mono text-text-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={ch.dmxMax}
                    onChange={(e) => updateChannel(ch.id, { dmxMax: Number(e.target.value) })}
                    className="w-14 rounded border border-border bg-panel2 px-1.5 py-1 text-center font-mono text-text-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={ch.defaultValue}
                    onChange={(e) => updateChannel(ch.id, { defaultValue: Number(e.target.value) })}
                    className="w-14 rounded border border-border bg-panel2 px-1.5 py-1 text-center font-mono text-text-primary"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`Curva de ${ch.name}`}
                    title={acceptsCurve(ch.type) ? undefined : "Solo en dimmer y colores"}
                    disabled={!acceptsCurve(ch.type)}
                    value={acceptsCurve(ch.type) ? ch.curve : "linear"}
                    onChange={(e) => updateChannel(ch.id, { curve: e.target.value as FixtureChannel["curve"] })}
                    className="rounded border border-border bg-panel2 px-1.5 py-1 text-text-primary outline-none disabled:opacity-40"
                  >
                    {CURVES.map((c) => (
                      <option key={c} value={c}>
                        {CURVE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={ch.invert}
                    onChange={(e) => updateChannel(ch.id, { invert: e.target.checked })}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    value={ch.notes ?? ""}
                    onChange={(e) => updateChannel(ch.id, { notes: e.target.value })}
                    className="w-full min-w-[140px] rounded border border-border bg-panel2 px-1.5 py-1 text-text-primary outline-none"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => removeChannel(ch.id)}
                    className="text-text-secondary hover:text-state-danger"
                    aria-label={`Eliminar canal ${ch.index}`}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Button size="sm" variant="ghost" className="mt-2" onClick={addChannel}>
        + Agregar canal
      </Button>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border pt-3">
        {repeated ? (
          <p role="alert" className="flex-1 text-xs text-state-warn">
            El canal {repeated.index} está repetido. Cada función necesita su propio número.
          </p>
        ) : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={handleSave}>
          Guardar perfil
        </Button>
      </div>
    </Panel>
  );
}
