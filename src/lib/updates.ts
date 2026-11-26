import { useCallback, useEffect, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

/** La versión de este programa (package.json). */
export const VERSION = __APP_VERSION__;

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
 * Pregunta una vez al abrir si hay una versión nueva (src-tauri/src/updates.rs)
 * y, si la hay, muestra el aviso. Instalar la descarga, apaga el motor y
 * reinicia el programa ya actualizado.
 */
export function useUpdate() {
  const [state, setState] = useState<UpdateState>({ version: null, notes: null, open: false, progress: null, error: null });

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    invoke<{ version: string; notes: string | null } | null>("check_update")
      .then((found) => {
        if (alive && found) setState((s) => ({ ...s, version: found.version, notes: found.notes, open: true }));
      })
      .catch(() => {});
    return () => {
      alive = false;
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
