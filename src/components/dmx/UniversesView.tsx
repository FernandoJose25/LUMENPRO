import { useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DMX_CHANNELS, universesOf } from "@/lib/dmxFrame";
import { useOutputFrame, type DmxOutput } from "@/lib/dmxOutput";
import { useFixtureStore } from "@/lib/fixtureStore";
import { GROUP_COLORS } from "@/types/group";

interface Slot {
  label: string;
  color: string;
}

/** Los 512 canales de un universo: de quién es cada uno y cuánto vale. */
export function UniversesView({ dmx }: { dmx: DmxOutput }) {
  const { instances, definitions } = useFixtureStore();
  const sent = dmx.status.outputs.map((o) => o.config.universe);
  const universes = universesOf(instances, sent);
  const [chosen, setChosen] = useState(1);
  const universe = universes.includes(chosen) ? chosen : universes[0];
  const frame = useOutputFrame(universe);

  const slots = useMemo(() => {
    const found: (Slot | undefined)[] = new Array<Slot | undefined>(DMX_CHANNELS).fill(undefined);
    instances
      .filter((i) => i.universe === universe)
      .forEach((instance, n) => {
        const color = GROUP_COLORS[n % GROUP_COLORS.length];
        for (const c of definitions.find((d) => d.id === instance.definitionId)?.channels ?? []) {
          const at = instance.address + c.index - 2;
          if (at >= 0 && at < DMX_CHANNELS) found[at] = { label: `${instance.label} · ${c.name}`, color };
        }
      });
    return found;
  }, [instances, definitions, universe]);

  const outputs = dmx.status.outputs.filter((o) => o.config.universe === universe);
  const used = slots.filter(Boolean).length;

  return (
    <div className="min-w-0 flex-1 p-2">
      <Panel title="UNIVERSOS">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {universes.map((u) => (
            <Button key={u} size="sm" selected={u === universe} onClick={() => setChosen(u)}>
              Universo {u}
            </Button>
          ))}
          <span className="ml-2 text-xs text-text-secondary">
            {used} canales usados · {DMX_CHANNELS - used} libres ·{" "}
            {outputs.length > 0 ? `sale por ${outputs.map((o) => o.name).join(", ")}` : "no sale por ningún lado"}
          </span>
        </div>
        <div className="grid gap-px" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(2.6rem, 1fr))" }}>
          {slots.map((slot, i) => (
            <div
              key={i}
              title={`Canal ${i + 1}${slot ? ` · ${slot.label}` : ""}`}
              className={`rounded-sm border-l-2 px-1 py-0.5 font-mono ${slot ? "bg-panel2" : "opacity-30"}`}
              style={{ borderColor: slot?.color ?? "transparent" }}
            >
              <div className="text-[9px] leading-tight text-text-secondary">{i + 1}</div>
              <div className={`text-[11px] leading-tight ${frame[i] ? "text-accent" : "text-text-secondary"}`}>
                {frame[i] ?? 0}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
