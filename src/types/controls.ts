import type { ChannelType } from "@/types/fixture";

/** Lo que hace un botón de Live, del celular o de un controlador MIDI. Lo
 *  ejecuta el motor (show-engine, `Show::act`). */
export type Action =
  | { do: "next" | "prev" | "stop" | "blackout" | "strobe" | "master" | "tap" | "speed" }
  | { do: "moment" | "scene" | "effect" | "chase" | "palette" | "timeline" | "special" | "arm"; id: string }
  | { do: "groupFader"; groupId: string; channelType: ChannelType }
  /** Color fijo encima del momento. Sin grupo, todos; sin color, se suelta. */
  | { do: "color"; groupId: string | null; color: string | null };

export const isFader = (action: Action) => action.do === "master" || action.do === "speed" || action.do === "groupFader";

/** Un botón de las pantallas a medida. */
export interface Pad {
  id: string;
  label: string;
  action: Action;
  /** 1 normal, 2 grande. */
  size: 1 | 2;
  /** Página donde va ("" o sin página = la primera). */
  page?: string;
  /** Color del botón, para encontrarlo de un vistazo. */
  color?: string | null;
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
