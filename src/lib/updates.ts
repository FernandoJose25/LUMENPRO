import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** La versión de este programa (package.json). */
export const VERSION = __APP_VERSION__;

const LATEST = "https://api.github.com/repos/FernandoJose25/LUMENPRO/releases/latest";

/** "v0.10.2" → [0, 10, 2]. */
const parts = (version: string) =>
  version
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);

export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [parts(candidate), parts(current)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** La versión nueva publicada en GitHub, si la hay. Pregunta una vez al abrir;
 *  sin internet (en un local, lo normal) no dice nada. */
export function useNewVersion(): string | null {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const abort = new AbortController();
    fetch(LATEST, { signal: abort.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? (r.json() as Promise<{ tag_name?: string }>) : null))
      .then((release) => {
        const tag = release?.tag_name;
        if (tag && isNewer(tag, VERSION)) setLatest(tag.replace(/^v/, ""));
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return latest;
}

export function openDownloads(): void {
  void invoke("open_release_page");
}
