import type { ChannelType } from "@/types/fixture";

/** Lo que hace un botón de Live, del celular o de un controlador MIDI. Lo
 *  ejecuta el motor (show-engine, `Show::act`). */
export type Action =
  | { do: "next" | "prev" | "stop" | "blackout" | "strobe" | "master" }
  | { do: "moment" | "scene" | "effect" | "chase" | "palette"; id: string }
  | { do: "groupFader"; groupId: string; channelType: ChannelType };

export const isFader = (action: Action) => action.do === "master" || action.do === "groupFader";

/** Un botón de las pantallas a medida. */
export interface Pad {
  id: string;
  label: string;
  action: Action;
  /** 1 normal, 2 grande. */
  size: 1 | 2;
}

/** Un botón o fader de un controlador MIDI. */
export interface Control {
  id: string;
  /** Nombre del controlador; vacío = cualquiera. */
  device: string;
  kind: "note" | "cc";
  /** 0–15. */
  channel: number;
  number: number;
  action: Action;
}
