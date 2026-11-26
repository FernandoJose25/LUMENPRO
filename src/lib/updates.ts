import { useCallback, useEffect, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** La versión de este programa (package.json). */
export const VERSION = __APP_VERSION__;

/** La ventana queda abierta horas: no basta con mirar al abrir. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

export interface UpdateState {
  /** La versión nueva, o null si no hay (o no hay internet). */
  version: string | null;
  notes: string | null;
  /** El aviso a la vista. */
  open: boolean;
  /** 0–100 mientras se descarga; null si no empezó. */
  progress: number | null;
  error: string | null;
}

/**
 * Pregunta al abrir y cada media hora si hay una versión nueva
 * (src-tauri/src/updates.rs) y, si la hay, muestra el aviso. Instalar la descarga, apaga el motor y
 * reinicia el programa ya actualizado.
 */
export function useUpdate() {
  const [state, setState] = useState<UpdateState>({ version: null, notes: null, open: false, progress: null, error: null });

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let shown: string | null = null;
    const check = () =>
      invoke<{ version: string; notes: string | null } | null>("check_update")
        .then((found) => {
          // Cada versión se avisa una vez; después queda el botón de arriba.
          if (!alive || !found || found.version === shown) return;
          shown = found.version;
          setState((s) => ({ ...s, version: found.version, notes: found.notes, open: true }));
        })
        .catch(() => {});
    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const install = useCallback(() => {
    const progress = new Channel<number>();
    progress.onmessage = (percent) => setState((s) => ({ ...s, progress: percent }));
    setState((s) => ({ ...s, progress: 0, error: null }));
    invoke("install_update", { progress }).catch((e) =>
      setState((s) => ({ ...s, progress: null, error: e instanceof Error ? e.message : String(e) })),
    );
  }, []);

  return {
    ...state,
    install,
    show: () => setState((s) => ({ ...s, open: true })),
    hide: () => setState((s) => ({ ...s, open: false })),
  };
}

export function openDownloads(): void {
  void invoke("open_release_page");
}
