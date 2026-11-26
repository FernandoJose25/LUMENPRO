import type { Action } from "@/types/controls";
import type { ShowDoc } from "@/lib/history";
import type { Playback } from "@/types/engine";
import { CHANNEL_TYPE_LABELS, type ChannelType } from "@/types/fixture";

type Rig = ShowDoc & Playback;

export interface ActionOption {
  key: string;
  label: string;
  group: string;
  action: Action;
}

export const actionKey = (action: Action) =>
  "id" in action ? `${action.do}:${action.id}` : action.do === "groupFader" ? `groupFader:${action.groupId}:${action.channelType}` : action.do;

/** Todo lo que se le puede asignar a un botón, con nombres para elegir. */
export function actionOptions(rig: Rig): ActionOption[] {
  const fixed: [Action, string][] = [
    [{ do: "next" }, "Siguiente momento"],
    [{ do: "prev" }, "Momento anterior"],
    [{ do: "stop" }, "Detener el momento"],
    [{ do: "blackout" }, "Blackout (enciende / apaga)"],
    [{ do: "strobe" }, "Estrobo (mientras se aprieta)"],
    [{ do: "master" }, "Intensidad general (fader)"],
  ];
  const options: ActionOption[] = fixed.map(([action, label]) => ({ key: actionKey(action), label, group: "Show", action }));
  const add = (group: string, items: { id: string; name: string }[], kind: "moment" | "scene" | "effect" | "chase" | "palette") => {
    for (const item of items) {
      const action: Action = { do: kind, id: item.id };
      options.push({ key: actionKey(action), label: item.name, group, action });
    }
  };
  add("Momentos", rig.moments, "moment");
  add("Escenas", rig.scenes, "scene");
  add("Effects (arranca / detiene)", rig.effects, "effect");
  add("Chases (arranca / detiene)", rig.chases, "chase");
  add("Paletas", rig.palettes, "palette");
  for (const group of rig.groups) {
    const types = new Set<ChannelType>();
    for (const instance of rig.instances.filter((i) => i.group === group.id)) {
      const definition = rig.definitions.find((d) => d.id === instance.definitionId);
      for (const c of definition?.channels ?? []) {
        if (["DIMMER", "RED", "GREEN", "BLUE", "WHITE", "AMBER", "UV", "ZOOM"].includes(c.type)) types.add(c.type);
      }
    }
    for (const channelType of types) {
      const action: Action = { do: "groupFader", groupId: group.id, channelType };
      options.push({
        key: actionKey(action),
        label: `${group.name}: ${CHANNEL_TYPE_LABELS[channelType]}`,
        group: "Faders de grupo",
        action,
      });
    }
  }
  return options;
}

export function actionLabel(action: Action, rig: Rig): string {
  return actionOptions(rig).find((o) => o.key === actionKey(action))?.label ?? "(borrado)";
}

/** Igual que `Show::is_active` en el motor. */
export function isActive(action: Action, rig: Rig): boolean {
  switch (action.do) {
    case "moment":
      return rig.activeMomentId === action.id && rig.momentRun !== null;
    case "scene":
      return rig.activeSceneId === action.id;
    case "effect":
      return rig.runningEffectIds.includes(action.id);
    case "chase":
      return rig.chase?.id === action.id;
    case "blackout":
      return rig.blackoutActive;
    case "strobe":
      return rig.strobeActive;
    default:
      return false;
  }
}
