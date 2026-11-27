import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { actionKey, actionLabel, actionOptions, isActive } from "@/lib/actions";
import { useFixtureStore } from "@/lib/fixtureStore";
import { cn } from "@/lib/utils";
import { isFader, type Pad } from "@/types/controls";

/** Botones a medida: en uso, o armándolos (`editing`). */
export function PadBoard({
  pads,
  editing,
  onChange,
  preview = false,
}: {
  pads: Pad[];
  editing: boolean;
  onChange: (pads: Pad[]) => void;
  /** Solo para ver cómo quedan (los del celular). */
  preview?: boolean;
}) {
  const store = useFixtureStore();
  const move = (index: number, by: -1 | 1) => {
    const next = [...pads];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {pads.length === 0 && !editing ? (
        <p className="text-xs text-text-secondary">Todavía no hay botones. Toca “Editar” para armarlos.</p>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
        {pads.map((pad, index) => (
          <div key={pad.id} className={cn("flex flex-col gap-1", pad.size === 2 && "col-span-2")}>
            <PadControl pad={pad} disabled={editing || preview} />
            {editing ? (
              <div className="flex items-center justify-between gap-1">
                <Button size="sm" variant="ghost" aria-label={`Mover ${pad.label} antes`} disabled={index === 0} onClick={() => move(index, -1)}>
                  ←
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${pad.size === 2 ? "Achicar" : "Agrandar"} ${pad.label}`}
                  onClick={() => onChange(pads.map((p) => (p.id === pad.id ? { ...p, size: p.size === 2 ? 1 : 2 } : p)))}
                >
                  {pad.size === 2 ? "Normal" : "Grande"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Mover ${pad.label} después`}
                  disabled={index === pads.length - 1}
                  onClick={() => move(index, 1)}
                >
                  →
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Quitar ${pad.label}`} onClick={() => onChange(pads.filter((p) => p.id !== pad.id))}>
                  ×
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {editing ? <NewPad onAdd={(pad) => onChange([...pads, pad])} /> : null}
      {editing && pads.some((p) => actionLabel(p.action, store) === "(borrado)") ? (
        <p className="text-[11px] text-state-warn">Hay botones de cosas que ya se borraron: no hacen nada.</p>
      ) : null}
    </div>
  );
}

function NewPad({ onAdd }: { onAdd: (pad: Pad) => void }) {
  const store = useFixtureStore();
  const options = actionOptions(store);
  const [key, setKey] = useState(options[0]?.key ?? "");
  const groups = [...new Set(options.map((o) => o.group))];
  const chosen = options.find((o) => o.key === key);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs">
      <select
        aria-label="Qué hace el botón nuevo"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
      >
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {options
              .filter((o) => o.group === group)
              .map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <Button
        variant="primary"
        disabled={!chosen}
        onClick={() =>
          chosen && onAdd({ id: `pad-${crypto.randomUUID()}`, label: chosen.label, action: chosen.action, size: 1 })
        }
      >
        + Botón
      </Button>
    </div>
  );
}

function PadControl({ pad, disabled }: { pad: Pad; disabled: boolean }) {
  const store = useFixtureStore();
  const { act, master } = store;
  const [value, setValue] = useState(0);
  const label = actionLabel(pad.action, store) === "(borrado)" ? `${pad.label} (borrado)` : pad.label;

  if (isFader(pad.action)) {
    const current = pad.action.do === "master" ? master : Math.round((value / 255) * 100);
    return (
      <div className="rounded-control border border-border px-2 py-1.5">
        <Fader
          label={label}
          value={current}
          max={100}
          disabled={disabled}
          onChange={(v) => {
            setValue(Math.round((v / 100) * 255));
            act(pad.action, undefined, v / 100);
          }}
        />
      </div>
    );
  }
  // El estrobo y los especiales que no se enclavan, mientras se aprieta.
  const special = pad.action.do === "special" ? store.specials.find((s) => "id" in pad.action && s.id === pad.action.id) : undefined;
  const hold = pad.action.do === "strobe" || (special !== undefined && !special.latch);
  const active = isActive(pad.action, store);
  return (
    <Button
      size="lg"
      disabled={disabled}
      variant={active ? (pad.action.do === "blackout" ? "danger" : "primary") : "secondary"}
      aria-pressed={active}
      className={cn("w-full whitespace-normal", pad.size === 2 && "h-20 text-lg")}
      onPointerDown={hold ? () => act(pad.action, true) : undefined}
      onPointerUp={hold ? () => act(pad.action, false) : undefined}
      onPointerLeave={hold && active ? () => act(pad.action, false) : undefined}
      onClick={hold ? undefined : () => act(pad.action, true)}
      title={actionKey(pad.action)}
    >
      {label}
    </Button>
  );
}
