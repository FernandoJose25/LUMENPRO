/**
 * Humo, chispas frías, CO2, confeti: un canal que sale en 0 salvo mientras se
 * dispara (show-engine, `Special`). Ni las escenas ni los effects lo tocan, y
 * el Blackout lo corta.
 */
export interface Special {
  id: string;
  name: string;
  kind: SpecialKind;
  instanceId: string;
  channelId: string;
  /** Valor DMX al disparar. */
  level: number;
  /** Lo más que dura un disparo, aunque se siga apretando. */
  maxMs: number;
  /** Hay que armarlo antes de disparar. */
  needsArm: boolean;
  /** Un toque lo prende y otro lo apaga, en vez de disparar mientras se aprieta. */
  latch: boolean;
}

export type SpecialKind = "smoke" | "haze" | "sparks" | "co2" | "confetti" | "other";

type Defaults = Pick<Special, "level" | "maxMs" | "needsArm" | "latch">;

export const SPECIAL_KINDS: Record<SpecialKind, { name: string; defaults: Defaults }> = {
  smoke: { name: "Humo", defaults: { level: 255, maxMs: 10_000, needsArm: false, latch: false } },
  haze: { name: "Haze", defaults: { level: 80, maxMs: 4 * 60 * 60_000, needsArm: false, latch: true } },
  sparks: { name: "Chispas frías", defaults: { level: 255, maxMs: 5000, needsArm: true, latch: false } },
  co2: { name: "CO2", defaults: { level: 255, maxMs: 3000, needsArm: true, latch: false } },
  confetti: { name: "Confeti", defaults: { level: 255, maxMs: 1000, needsArm: true, latch: false } },
  other: { name: "Otro", defaults: { level: 255, maxMs: 5000, needsArm: true, latch: false } },
};
