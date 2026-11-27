import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { askConfirm } from "@/lib/dialogs";
import { engineNow } from "@/lib/engineClock";
import { useFixtureStore } from "@/lib/fixtureStore";
import { SPECIAL_KINDS, type Special, type SpecialKind } from "@/types/special";

const fieldClass =
  "h-8 rounded-control border border-border bg-panel2 px-2 text-xs text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Humo, chispas frías, CO2 y confeti. Su canal sale en 0 salvo mientras se
 * dispara: ninguna escena ni effect lo prende por error, y el Blackout lo
 * corta. Los que lo piden hay que armarlos antes (dura 5 minutos).
 */
export function Specials() {
  const { specials } = useFixtureStore();
  const [editing, setEditing] = useState(false);

  return (
    <section aria-label="Efectos especiales" className="flex shrink-0 flex-col gap-2 rounded-panel border border-border bg-panel p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-text-secondary">EFECTOS ESPECIALES</span>
        <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)}>
          {editing ? "Listo" : specials.length === 0 ? "Agregar humo, chispas…" : "Configurar"}
        </Button>
      </div>
      {editing ? <SpecialsEditor /> : <SpecialsBoard />}
    </section>
  );
}

function SpecialsBoard() {
  const { specials, firing, armed, act } = useFixtureStore();
  const [, setTick] = useState(0);
  const anyArmed = Object.keys(armed).length > 0;
  useEffect(() => {
    if (!anyArmed) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [anyArmed]);
  if (specials.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {specials.map((s) => {
        const isFiring = firing[s.id] !== undefined;
        const armedUntil = armed[s.id];
        const assigned = s.instanceId !== "" && s.channelId !== "";
        const ready = assigned && (!s.needsArm || armedUntil !== undefined);
        const fire = (on: boolean) => act({ do: "special", id: s.id }, on);
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            {s.needsArm ? (
              <Button
                size="lg"
                variant={armedUntil !== undefined ? "danger" : "secondary"}
                aria-pressed={armedUntil !== undefined}
                aria-label={`Armar ${s.name}`}
                onClick={() => act({ do: "arm", id: s.id }, true)}
              >
                {armedUntil !== undefined ? `ARMADO ${clock(armedUntil - engineNow())}` : "Armar"}
              </Button>
            ) : null}
            <Button
              size="lg"
              variant={isFiring ? "primary" : "secondary"}
              aria-pressed={isFiring}
              disabled={!ready}
              title={!assigned ? "Elige su máquina en Configurar" : ready ? undefined : "Primero toca Armar"}
              className={cn("min-w-36 select-none touch-none", isFiring && "ring-2 ring-accent")}
              onPointerDown={s.latch ? undefined : () => fire(true)}
              onPointerUp={s.latch ? undefined : () => fire(false)}
              onPointerLeave={s.latch || !isFiring ? undefined : () => fire(false)}
              onClick={s.latch ? () => fire(true) : undefined}
            >
              {s.latch ? `${s.name}: ${isFiring ? "apagar" : "prender"}` : isFiring ? `${s.name}…` : `Mantener: ${s.name}`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function SpecialsEditor() {
  const { specials, instances, definitions, addSpecial, updateSpecial, removeSpecial } = useFixtureStore();

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-text-secondary">
        Elige la máquina (agrégala antes en Fixtures, por ejemplo «Humo» en la biblioteca) y el canal que la dispara. Ese canal
        queda en 0 salvo mientras se dispara.
      </p>
      {specials.map((s) => (
        <SpecialRow
          key={s.id}
          special={s}
          instances={instances}
          definitions={definitions}
          onChange={(patch) => updateSpecial(s.id, patch)}
          onRemove={() => askConfirm(`¿Quitar «${s.name}»?`, "Quitar", () => removeSpecial(s.id))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(SPECIAL_KINDS) as SpecialKind[]).map((kind) => (
          <Button key={kind} size="sm" onClick={() => addSpecial(kind)}>
            + {SPECIAL_KINDS[kind].name}
          </Button>
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  special: Special;
  instances: ReturnType<typeof useFixtureStore>["instances"];
  definitions: ReturnType<typeof useFixtureStore>["definitions"];
  onChange: (patch: Partial<Omit<Special, "id">>) => void;
  onRemove: () => void;
}

function SpecialRow({ special: s, instances, definitions, onChange, onRemove }: RowProps) {
  const instance = instances.find((i) => i.id === s.instanceId);
  const definition = definitions.find((d) => d.id === instance?.definitionId);
  const channels = definition?.channels ?? [];
  // Una luz (tiene dimmer, color o pan) no es una máquina de efectos.
  const isLight = definition?.channels.some((c) => ["DIMMER", "PAN", "RED"].includes(c.type)) ?? false;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-control border border-border bg-panel2/50 p-2">
      <input aria-label="Nombre" value={s.name} onChange={(e) => onChange({ name: e.target.value })} className={cn(fieldClass, "w-28")} />
      <select
        aria-label={`Máquina de ${s.name}`}
        value={s.instanceId}
        onChange={(e) => {
          const next = instances.find((i) => i.id === e.target.value);
          const first = definitions.find((d) => d.id === next?.definitionId)?.channels[0];
          onChange({ instanceId: e.target.value, channelId: first?.id ?? "" });
        }}
        className={fieldClass}
      >
        <option value="">— elige la máquina —</option>
        {instances.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
      <select aria-label={`Canal de ${s.name}`} value={s.channelId} onChange={(e) => onChange({ channelId: e.target.value })} className={fieldClass}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.index}. {c.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
        Valor
        <input
          type="number"
          aria-label={`Valor de ${s.name}`}
          min={0}
          max={255}
          value={s.level}
          onChange={(e) => onChange({ level: Math.max(0, Math.min(255, Number(e.target.value) || 0)) })}
          className={cn(fieldClass, "w-16")}
        />
      </label>
      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
        Máx. s
        <input
          type="number"
          aria-label={`Segundos máximos de ${s.name}`}
          min={0.5}
          step={0.5}
          value={s.maxMs / 1000}
          onChange={(e) => onChange({ maxMs: Math.max(500, Math.round((Number(e.target.value) || 0) * 1000)) })}
          className={cn(fieldClass, "w-20")}
        />
      </label>
      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
        <input type="checkbox" checked={s.needsArm} onChange={(e) => onChange({ needsArm: e.target.checked })} />
        Pide armar
      </label>
      <label className="flex items-center gap-1 text-[11px] text-text-secondary">
        <input type="checkbox" checked={s.latch} onChange={(e) => onChange({ latch: e.target.checked })} />
        Un toque prende, otro apaga
      </label>
      {isLight ? (
        <p className="w-full text-[11px] text-state-warn">
          Ojo: «{instance?.label}» es una luz. Ese canal quedará en 0 salvo al disparar.
        </p>
      ) : null}
      <button
        type="button"
        aria-label={`Quitar ${s.name}`}
        onClick={onRemove}
        className="ml-auto h-6 w-6 rounded-control text-text-secondary hover:bg-panel hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
