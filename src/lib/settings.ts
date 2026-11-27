import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Preferencias de esta PC (no del show). En la app de escritorio también van a
 * disco: si la ventana se reabre tras una caída puede usar otra carpeta de
 * WebView2, con el localStorage vacío.
 */
const PREFIX = "lumenpro.";
const KEYS = ["audio", "dmx.outputs", "dmx.last", "song.output", "live.effectGroups", "effects.catalog", "music.links", "music.autoLights"] as const;
export type SettingKey = (typeof KEYS)[number];

export function readSetting<T>(key: SettingKey): T | null {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

export function writeSetting(key: SettingKey, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Sin localStorage la elección dura lo que la ventana.
  }
  if (!isTauri()) return;
  const json = JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, readSetting(k)])));
  invoke("save_settings", { json }).catch((e) => console.error("No se pudieron guardar las preferencias", e));
}

/** Trae las preferencias del disco antes del primer render. */
export async function hydrateSettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    const json = await invoke<string | null>("load_settings");
    if (!json) return;
    const saved = JSON.parse(json) as Partial<Record<SettingKey, unknown>>;
    for (const key of KEYS) {
      const value = saved[key];
      if (value !== undefined && value !== null) localStorage.setItem(PREFIX + key, JSON.stringify(value));
      else localStorage.removeItem(PREFIX + key);
    }
  } catch (e) {
    console.error("No se pudieron leer las preferencias", e);
  }
}
