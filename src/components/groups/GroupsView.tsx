import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { cn } from "@/lib/utils";
import { useFixtureStore } from "@/lib/fixtureStore";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";

/**
 * Fase 4 — Groups. Primer consumidor real de `FixtureInstance.group`
 * (antes existía en el tipo pero ninguna pantalla lo usaba). Dos paneles:
 * izquierda gestiona los grupos y qué fixtures pertenecen a cada uno;
 * derecha es "Group Control" — un fader por cada tipo de canal presente
 * en el grupo (Dimmer, Color, Strobe...) que escribe el mismo valor a
 * todos los fixtures miembro simultáneamente, resuelto por `ChannelType`
 * porque cada modelo puede tener ese canal en un índice DMX distinto.
 */
export function GroupsView() {
  const {
    groups,
    instances,
    definitions,
    addGroup,
    renameGroup,
    removeGroup,
    setInstanceGroup,
  } = useFixtureStore();

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  useEffect(() => {
    if (selectedGroupId && !groups.some((g) => g.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? null);
    }
  }, [groups, selectedGroupId]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  function handleCreate() {
    const name = window.prompt("Nombre del grupo (p. ej. \"Cabezas móviles\"):", `Grupo ${groups.length + 1}`);
    if (name === null) return;
    const created = addGroup(name);
    setSelectedGroupId(created.id);
  }

  function startRename(groupId: string, currentName: string) {
    setRenamingId(groupId);
    setDraftName(currentName);
  }

  function commitRename(groupId: string) {
    renameGroup(groupId, draftName);
    setRenamingId(null);
  }

  function handleDelete(groupId: string, name: string) {
    if (window.confirm(`¿Borrar el grupo "${name}"? Los fixtures quedan sin grupo (no se borran).`)) {
      removeGroup(groupId);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-[340px] shrink-0">
        <Panel title="GROUPS" className="h-full">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const isSelected = g.id === selectedGroupId;
              const isRenaming = renamingId === g.id;
              const memberCount = instances.filter((i) => i.group === g.id).length;

              if (isRenaming) {
                return (
                  <input
                    key={g.id}
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(g.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(g.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-9 w-32 rounded-control border border-accent bg-panel2 px-2.5 text-sm text-text-primary outline-none"
                  />
                );
              }

              return (
                <div key={g.id} className="group relative">
                  <Button
                    size="md"
                    variant="secondary"
                    selected={isSelected}
                    onClick={() => setSelectedGroupId(g.id)}
                    onDoubleClick={() => startRename(g.id, g.name)}
                    title="Clic: seleccionar · Doble clic: renombrar"
                    className={cn("gap-2", isSelected && "bg-accent/15 text-accent")}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: g.color }}
                      aria-hidden
                    />
                    {g.name}
                    <span className="text-[10px] text-text-secondary">{memberCount}</span>
                  </Button>
                  <button
                    type="button"
                    title="Borrar grupo"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(g.id, g.name);
                    }}
                    className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-panel2 text-[10px] text-text-secondary ring-1 ring-border hover:text-state-danger group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <Button size="md" variant="primary" onClick={handleCreate}>
              + Nuevo grupo
            </Button>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 text-[11px] font-medium text-text-secondary">
              {selectedGroup ? `FIXTURES — asignar a "${selectedGroup.name}"` : "Selecciona o crea un grupo"}
            </div>
            <div className="flex max-h-[calc(100%-2rem)] flex-col gap-1 overflow-y-auto scrollbar-thin pr-1">
              {instances.map((instance) => {
                const def = definitions.find((d) => d.id === instance.definitionId);
                const isMember = instance.group === selectedGroupId;
                const otherGroup = instance.group && instance.group !== selectedGroupId
                  ? groups.find((g) => g.id === instance.group)
                  : null;

                return (
                  <label
                    key={instance.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-xs",
                      selectedGroup ? "hover:bg-panel2" : "cursor-not-allowed opacity-50",
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={!selectedGroup}
                      checked={isMember}
                      onChange={() =>
                        setInstanceGroup(instance.id, isMember ? null : selectedGroupId)
                      }
                      className="accent-accent"
                    />
                    <span className="flex-1 truncate text-text-primary">{instance.label}</span>
                    <span className="font-mono text-[10px] text-text-secondary">
                      {def?.model ?? "?"} · DMX {instance.address}
                    </span>
                    {otherGroup ? (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px]"
                        style={{ backgroundColor: `${otherGroup.color}22`, color: otherGroup.color }}
                      >
                        {otherGroup.name}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </div>
        </Panel>
      </div>

      <div className="min-w-0 flex-1">
        <GroupControl groupId={selectedGroupId} />
      </div>
    </div>
  );
}

/** Fader por tipo de canal, aplicado a todos los miembros del grupo a la
 *  vez. No refleja "el" valor actual del grupo (fixtures distintos pueden
 *  estar en valores distintos) — es un control de escritura tipo "master",
 *  como el fader de un grupo en una consola real: mover, no espejo. */
function GroupControl({ groupId }: { groupId: string | null }) {
  const { groups, instances, definitions, setGroupChannelByType } = useFixtureStore();
  const [localValues, setLocalValues] = useState<Record<string, number>>({});

  const group = groups.find((g) => g.id === groupId) ?? null;
  const members = instances.filter((i) => i.group === groupId);

  const channelTypes = useMemo(() => {
    const types = new Set<ChannelType>();
    for (const member of members) {
      const def = definitions.find((d) => d.id === member.definitionId);
      def?.channels.forEach((ch) => types.add(ch.type));
    }
    return Array.from(types);
  }, [members, definitions]);

  useEffect(() => {
    setLocalValues({});
  }, [groupId]);

  if (!group) {
    return (
      <Panel title="GROUP CONTROL" className="h-full">
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          Selecciona un grupo a la izquierda (o crea uno) para controlarlo aquí.
        </div>
      </Panel>
    );
  }

  if (members.length === 0) {
    return (
      <Panel title={`GROUP CONTROL — ${group.name}`} className="h-full">
        <div className="flex h-full items-center justify-center text-center text-xs text-text-secondary">
          Este grupo no tiene fixtures todavía. Márcalos en la lista de la izquierda.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={`GROUP CONTROL — ${group.name}`} className="h-full">
      <div className="mb-3 font-mono text-[11px] text-text-secondary">
        {members.length} fixture{members.length === 1 ? "" : "s"} · {channelTypes.length} tipo
        {channelTypes.length === 1 ? "" : "s"} de canal en común
      </div>
      <div className="flex max-h-[calc(100%-3rem)] flex-col gap-2.5 overflow-y-auto scrollbar-thin pr-1">
        {channelTypes.map((type) => (
          <Fader
            key={type}
            label={CHANNEL_TYPE_LABELS[type]}
            value={localValues[type] ?? 0}
            min={0}
            max={255}
            onChange={(v) => {
              setLocalValues((prev) => ({ ...prev, [type]: v }));
              setGroupChannelByType(group.id, type, v);
            }}
          />
        ))}
      </div>
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-text-secondary">
        Mover un fader aquí escribe ese valor en todos los fixtures del grupo que tengan ese
        tipo de canal (no importa en qué índice DMX esté en cada modelo). No refleja el valor
        actual de cada fixture — es un control de escritura, como el master de grupo de una
        consola real.
      </p>
    </Panel>
  );
}
