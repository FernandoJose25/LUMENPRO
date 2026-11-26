import { useEffect, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { PadBoard } from "@/components/pads/PadBoard";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { RemoteControl } from "@/lib/remoteControl";

/** Enciende el control por celular y muestra cómo entrar. */
export function RemoteView({ remote }: { remote: RemoteControl }) {
  const { available, status, refresh } = remote;

  // La dirección cambia al conectarse a otra WiFi con la pantalla abierta.
  useEffect(() => {
    if (!available) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [available, refresh]);

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-96 shrink-0">
        <Panel title="CONTROL POR CELULAR">
          {!available ? (
            <p className="text-xs text-text-secondary">
              En el navegador no se puede. Abre la app de escritorio de LUMEN PRO.
            </p>
          ) : status ? (
            <Access remote={remote} status={status} />
          ) : null}
          {(remote.error ?? status?.error) ? (
            <p role="alert" className="mt-3 text-xs text-state-danger">
              {remote.error ?? status?.error}
            </p>
          ) : null}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <PhonePads />
        <Panel title="CÓMO SE USA">
          <ol className="flex max-w-xl list-decimal flex-col gap-2 pl-4 text-sm text-text-secondary">
            <li>Conecta la laptop y el celular a la misma WiFi. No hace falta internet.</li>
            <li>Sin router: activa el punto de acceso del celular y conecta la laptop a él.</li>
            <li>Enciende el control y escanea el QR. Si Windows pregunta por el firewall, permite el acceso.</li>
            <li>No cierres la tapa de la laptop. Si se apaga el celular, las luces siguen.</li>
          </ol>
          <p className="mt-3 max-w-xl text-xs text-text-secondary">
            Usa una WiFi propia con contraseña, no la del local: la conexión no va cifrada y el PIN solo frena a
            curiosos.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** Los botones que aparecen arriba en el celular. */
function PhonePads() {
  const { phonePads, setPhonePads } = useFixtureStore();
  return (
    <Panel title="BOTONES DEL CELULAR" className="h-auto">
      <p className="mb-3 text-xs text-text-secondary">
        Aparecen arriba de todo en el celular, en este orden. Siguiente, los momentos, intensidad, estrobo y Blackout
        siguen estando debajo.
      </p>
      <PadBoard pads={phonePads} editing onChange={setPhonePads} preview />
    </Panel>
  );
}

function Access({ remote, status }: { remote: RemoteControl; status: NonNullable<RemoteControl["status"]> }) {
  const [chosenUrl, setChosenUrl] = useState<string | null>(null);
  const address = status.addresses.find((a) => a.url === chosenUrl) ?? status.addresses[0];

  if (!status.running) {
    return (
      <div className="flex flex-col gap-3">
        <StatusIndicator status="idle" label="Apagado" />
        <Button variant="primary" size="lg" onClick={() => void remote.setEnabled(true)}>
          Encender
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusIndicator status="ok" label="Encendido" />
      {address ? (
        <>
          <svg
            role="img"
            aria-label={`QR de ${address.url}`}
            viewBox={`-3 -3 ${address.qrSize + 6} ${address.qrSize + 6}`}
            shapeRendering="crispEdges"
            className="w-56 self-center rounded-control bg-white"
          >
            <path d={address.qrPath} fill="#000" />
          </svg>
          {status.addresses.length > 1 ? (
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              Si no abre, prueba otra dirección
              <select
                aria-label="Dirección"
                value={address.url}
                onChange={(e) => setChosenUrl(e.target.value)}
                className="h-9 rounded-control border border-border bg-panel2 px-2 font-mono text-sm text-text-primary outline-none"
              >
                {status.addresses.map((a) => (
                  <option key={a.url}>{a.url}</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-center font-mono text-sm text-text-primary">{address.url}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-state-warn">Esta laptop no está conectada a ninguna red.</p>
      )}
      <p className="text-center text-xs text-text-secondary">
        PIN
        <span className="block font-mono text-3xl tracking-widest text-text-primary">{status.pin}</span>
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => void remote.newPin()} title="Desconecta a todos los celulares">
          Cambiar PIN
        </Button>
        <Button className="flex-1" onClick={() => void remote.setEnabled(false)}>
          Apagar
        </Button>
      </div>
    </div>
  );
}
