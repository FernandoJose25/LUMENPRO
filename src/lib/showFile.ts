import { invoke, isTauri } from "@tauri-apps/api/core";

/** Clave del show en localStorage. En la app de escritorio es solo una copia:
 *  manda el archivo show.json (ver src-tauri/src/show.rs). */
export const STORAGE_KEY = "lumenpro.fixtures.v1";

/** Trae el show del disco a localStorage antes del primer render. */
export async function hydrateShowFromDisk(): Promise<void> {
  if (!isTauri()) return;
  try {
    const json = await invoke<string | null>("load_show");
    if (json) localStorage.setItem(STORAGE_KEY, json);
  } catch (e) {
    // Se sigue con la copia de localStorage.
    console.error("No se pudo leer show.json", e);
  }
}

// En cola: dos guardados simultáneos podrían terminar en orden inverso y
// dejar en disco la versión vieja.
let writeQueue: Promise<unknown> = Promise.resolve();

export function writeShow(json: string): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Modo privado o cuota llena: se sigue en memoria (y en disco, si lo hay).
  }
  if (!isTauri()) return Promise.resolve();
  const write = writeQueue.catch(() => {}).then(() => invoke<void>("save_show", { json }));
  writeQueue = write;
  return write;
}

function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `lumenpro-show-${date}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** Guarda una copia del show y devuelve dónde quedó. */
export async function exportShowFile(json: string): Promise<string> {
  const fileName = exportFileName(new Date());
  if (isTauri()) return invoke<string>("export_show", { fileName, json });

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return `Descargas/${fileName}`;
}
