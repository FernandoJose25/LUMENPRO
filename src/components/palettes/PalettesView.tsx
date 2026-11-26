import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { askConfirm, askText } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import { instancesFor, PALETTE_KINDS } from "@/lib/palettes";
import { PALETTE_KIND_LABELS, type Palette, type PaletteKind } from "@/types/palette";

const SAVE_LABELS: Record<PaletteKind, string> = {
  position: "+ Guardar la posición actual",
  color: "+ Guardar el color actual",
  beam: "+ Guardar el gobo actual",
};

/** Posiciones, colores y gobos con nombre. */
export function PalettesView() {
  const store = useFixtureStore();
  const { groups, instances, palettes, scenes } = store;
  const [target, setTarget] = useState("");
  const chosen = target ? instances.filter((i) => i.group === target) : instances;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-3 rounded-panel border border-border bg-panel px-3 py-2 text-xs text-text-secondary">
        <label className="flex items-center gap-2">
          Luces
          <select
            aria-label="Luces"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-8 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
          >
            <option value="">Todas</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          Tocar una paleta la pone en esas luces. Las escenas guardadas con una paleta puesta la siguen: si la corriges
          con ⟳, cambian todas.
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-2">
        {PALETTE_KINDS.map((kind) => (
          <Column
            key={kind}
            kind={kind}
            palettes={palettes.filter((p) => p.kind === kind)}
            usedBy={(p) => scenes.filter((s) => Object.values(s.refs ?? {}).some((r) => r[kind] === p.id)).length}
            canSave={instancesFor(store, kind, chosen).length > 0}
            onSave={() =>
              askText("Nombre", "", (name) => name && store.addPalette(kind, name, instancesFor(store, kind, chosen)))
            }
            onApply={(p) => store.applyPalette(p.id, chosen)}
            onUpdate={(p) => store.updatePalette(p.id)}
            onRename={(p) => askText("Nuevo nombre", p.name, (name) => name && store.renamePalette(p.id, name))}
            onRemove={(p) =>
              askConfirm(`¿Borrar "${p.name}"? Las escenas que la usan se quedan con sus valores de ahora.`, "Borrar", () =>
                store.removePalette(p.id),
              )
            }
            onColor={
              kind === "color"
                ? (hex) => askText("Nombre del color", "", (name) => name && store.addColorPalette(name, hex))
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function Column({
  kind,
  palettes,
  usedBy,
  canSave,
  onSave,
  onApply,
  onUpdate,
  onRename,
  onRemove,
  onColor,
}: {
  kind: PaletteKind;
  palettes: Palette[];
  usedBy: (p: Palette) => number;
  canSave: boolean;
  onSave: () => void;
  onApply: (p: Palette) => void;
  onUpdate: (p: Palette) => void;
  onRename: (p: Palette) => void;
  onRemove: (p: Palette) => void;
  onColor?: (hex: string) => void;
}) {
  return (
    <Panel title={PALETTE_KIND_LABELS[kind].toUpperCase()}>
      <div className="flex flex-col gap-1.5">
        {palettes.length === 0 ? (
          <p className="text-xs text-text-secondary">
            {kind === "position"
              ? 'Apunta las cabezas (en Escenario, con "Apuntar", o con el pad) y guarda la posición: "Pista", "Mesa principal"…'
              : "Todavía ninguna."}
          </p>
        ) : null}
        {palettes.map((p) => (
          <div key={p.id} className="flex items-center gap-1">
            <Button className="min-w-0 flex-1 justify-start" onClick={() => onApply(p)}>
              {p.hex ? <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.hex }} aria-hidden /> : null}
              <span className="truncate">{p.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-text-secondary">
                {usedBy(p) > 0 ? `${usedBy(p)} esc.` : ""}
              </span>
            </Button>
            <Button size="sm" variant="ghost" title="Guardar aquí lo que tienen ahora" aria-label={`Actualizar ${p.name}`} onClick={() => onUpdate(p)}>
              ⟳
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Renombrar ${p.name}`} onClick={() => onRename(p)}>
              ✎
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Borrar ${p.name}`} onClick={() => onRemove(p)}>
              ×
            </Button>
          </div>
        ))}
        <Button variant="primary" className="mt-1" disabled={!canSave} onClick={onSave}>
          {SAVE_LABELS[kind]}
        </Button>
        {onColor ? (
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="color"
              aria-label="Nuevo color"
              onChange={(e) => onColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded-control border border-border bg-panel2"
            />
            o elige un color
          </label>
        ) : null}
      </div>
    </Panel>
  );
}

/** Las paletas que sirven para esas luces, en un toque. */
export function PaletteChips({ instanceIds }: { instanceIds: string[] }) {
  const { palettes, instances, applyPalette } = useFixtureStore();
  const chosen = instances.filter((i) => instanceIds.includes(i.id));
  const useful = palettes.filter((p) => p.hex || chosen.some((i) => p.values[i.id]));
  if (useful.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Paletas">
      {useful.map((p) => (
        <Button key={p.id} size="sm" title={PALETTE_KIND_LABELS[p.kind]} onClick={() => applyPalette(p.id, chosen)}>
          {p.hex ? <span className="h-3 w-3 rounded-full" style={{ background: p.hex }} aria-hidden /> : null}
          {p.name}
        </Button>
      ))}
    </div>
  );
}
