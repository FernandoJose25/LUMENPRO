import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { useFixtureStore } from "@/lib/fixtureStore";

interface Os2lStatus {
  enabled: boolean;
  port: number | null;
  clients: number;
  error: string | null;
  addresses: string[];
}

const PORT = 9996;

/**
 * VirtualDJ le manda a LUMEN cada golpe exacto y sus botones (protocolo
 * OS2L), por la misma WiFi o un cable de red. Lo atiende el motor
 * (src-tauri/src/engine/os2l.rs): sigue aunque se cierre la ventana.
 */
export function VirtualDj() {
  const { engine, djBpm } = useFixtureStore();
  const [status, setStatus] = useState<Os2lStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!engine.desktop) return;
    let alive = true;
    const load = () =>
      engine.request<Os2lStatus>({ cmd: "os2lStatus" }).then(
        (s) => alive && setStatus(s),
        () => {},
      );
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [engine]);

  const toggle = (enabled: boolean) =>
    engine.request<Os2lStatus>({ cmd: "os2lSetEnabled", enabled }).then(
      (s) => {
        setStatus(s);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  const connected = (status?.clients ?? 0) > 0;
  const address = `${status?.addresses[0] ?? "IP-de-esta-laptop"}:${status?.port ?? PORT}`;

  return (
    <Panel title="VIRTUALDJ (OS2L)">
      <p className="text-xs text-text-secondary">
        Si el DJ usa VirtualDJ, le manda a LUMEN cada golpe exacto (sin micrófono) y sus botones. La laptop del DJ y esta
        tienen que estar en la misma WiFi o unidas con un cable de red.
      </p>
      {!engine.desktop ? (
        <p className="mt-3 text-xs text-text-secondary">Solo en la app de escritorio.</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant={status?.enabled ? "danger" : "primary"} onClick={() => void toggle(!status?.enabled)}>
              {status?.enabled ? "Desconectar VirtualDJ" : "Conectar con VirtualDJ"}
            </Button>
            {status?.enabled ? (
              <StatusIndicator
                status={connected ? "ok" : "warn"}
                label="VirtualDJ"
                detail={connected ? (djBpm !== null ? `conectado · ${Math.round(djBpm)} BPM` : "conectado") : "esperando…"}
              />
            ) : null}
          </div>
          {error || status?.error ? (
            <p role="alert" className="mt-2 text-xs text-state-danger">
              {error ?? status?.error}
            </p>
          ) : null}
          {status?.enabled ? (
            <div className="mt-3 flex flex-col gap-2 text-xs text-text-secondary">
              <p>
                Si Windows pregunta por el firewall, permite el acceso. VirtualDJ suele encontrar a LUMEN solo; si no, en
                VirtualDJ ve a <b className="text-text-primary">Configuración → Opciones</b>, busca{" "}
                <b className="text-text-primary">os2lDirectIp</b> y escribe:
              </p>
              <code className="w-fit rounded-control border border-border bg-panel2 px-2 py-1 font-mono text-sm text-text-primary">
                {address}
              </code>
              <p>
                Botones: en VirtualDJ, un botón con <code className="text-text-primary">os2l_button "Hora loca"</code> lanza el
                momento, efecto, efecto especial o línea de tiempo con ese nombre. También entiende «Siguiente», «Anterior»,
                «Blackout», «Estrobo» y «Tap».
              </p>
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}
