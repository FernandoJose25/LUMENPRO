import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { describePatch } from "@/lib/dmxFrame";
import { DEFAULT_FPS, useOutputFrame, type DmxAdapter, type DmxOutput } from "@/lib/dmxOutput";
import { useFixtureStore } from "@/lib/fixtureStore";

const ADAPTERS: { id: DmxAdapter; label: string }[] = [
  { id: "open_dmx", label: "Cable FTDI (Open DMX)" },
  { id: "enttec", label: "Enttec DMX USB PRO" },
  { id: "mock", label: "Simulado (sin cable)" },
];

const SPEEDS = [20, 25, 30, 35, 40];

const CHIP_LABELS = { ftdi: "FTDI", ch340: "CH340", other: "" } as const;

const selectClass =
  "h-9 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** Conexión con el adaptador USB-DMX y lo que está saliendo por el cable. */
export function DmxOutputView({ dmx }: { dmx: DmxOutput }) {
  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-80 shrink-0">
        <Panel title="CONEXIÓN">
          {dmx.available ? (
            <Connection dmx={dmx} />
          ) : (
            <p className="text-xs text-text-secondary">
              En el navegador no hay salida DMX. Abre la app de escritorio de LUMEN PRO para
              conectar el adaptador.
            </p>
          )}
        </Panel>
      </div>
      <div className="min-w-0 flex-1">
        <OutputMonitor />
      </div>
    </div>
  );
}

function Connection({ dmx }: { dmx: DmxOutput }) {
  const [adapter, setAdapter] = useState<DmxAdapter>("open_dmx");
  const [chosenPort, setChosenPort] = useState<string | null>(null);
  const [fps, setFps] = useState(DEFAULT_FPS);

  // Sin elección explícita (o si el puerto elegido desapareció), se propone
  // el primer FTDI: casi siempre es el único adaptador enchufado.
  const port =
    dmx.ports.find((p) => p.name === chosenPort) ??
    dmx.ports.find((p) => p.chip === "ftdi") ??
    dmx.ports[0];
  const needsPort = adapter !== "mock";
  const { state, output, lastError } = dmx.status;

  return (
    <div className="flex flex-col gap-3 text-xs text-text-secondary">
      {state === "running" ? (
        <>
          <StatusIndicator status="ok" label={output} detail={`${dmx.status.fps} FPS`} />
          <span title="Desde que se conectó. A 30 FPS lo normal son unos 35 ms; más de 100 es un corte.">
            Pausa más larga: {dmx.status.worstGapMs} ms
          </span>
        </>
      ) : state === "reconnecting" ? (
        <StatusIndicator status="warn" label={output} detail="reconectando…" />
      ) : (
        <StatusIndicator status="danger" label="Sin conexión" />
      )}

      {state === "stopped" ? (
        <>
          <label className="flex flex-col gap-1">
            Adaptador
            <select
              value={adapter}
              onChange={(e) => setAdapter(e.target.value as DmxAdapter)}
              className={selectClass}
            >
              {ADAPTERS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>

          {needsPort ? (
            <label className="flex flex-col gap-1">
              Puerto
              <div className="flex gap-1.5">
                <select
                  value={port?.name ?? ""}
                  onChange={(e) => setChosenPort(e.target.value)}
                  disabled={dmx.ports.length === 0}
                  className={`${selectClass} min-w-0 flex-1`}
                >
                  {dmx.ports.length === 0 ? <option value="">Ningún puerto</option> : null}
                  {dmx.ports.map((p) => (
                    <option key={p.name} value={p.name}>
                      {[p.name, CHIP_LABELS[p.chip], p.description].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
                <Button onClick={() => void dmx.refreshPorts()}>Buscar</Button>
              </div>
            </label>
          ) : null}

          {needsPort && port?.chip === "ch340" ? (
            <p className="text-state-warn">
              Este adaptador usa un chip CH340, no FTDI: es probable que las luces parpadeen.
            </p>
          ) : null}

          <label className="flex flex-col gap-1">
            Velocidad
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className={selectClass}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s} FPS
                </option>
              ))}
            </select>
            <span className="text-[11px]">Si las luces parpadean, bájala.</span>
          </label>

          <Button
            variant="primary"
            size="lg"
            disabled={needsPort && !port}
            onClick={() => void dmx.connect(adapter, port?.name ?? "", fps)}
          >
            Conectar
          </Button>
        </>
      ) : (
        <Button variant="secondary" size="lg" onClick={() => void dmx.disconnect()}>
          Desconectar
        </Button>
      )}

      {dmx.error ?? lastError ? (
        <p role="alert" className="text-state-danger">
          {dmx.error ?? lastError}
        </p>
      ) : null}
      <p>
        Si el puerto aparece ocupado, cierra QLC+, FreeStyler u otro programa DMX: solo uno puede
        usarlo a la vez.
      </p>
    </div>
  );
}

function OutputMonitor() {
  const frame = useOutputFrame(1);
  const { instances, definitions, identifyId, identify } = useFixtureStore();

  return (
    <Panel title="SALIDA — UNIVERSO 1">
      <div className="flex flex-col gap-2">
        {describePatch(instances, definitions).map(({ instance, first, last, issues }) => (
          <div key={instance.id} className="rounded-control border border-border px-3 py-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="flex-1 font-medium text-text-primary">{instance.label}</span>
              <Button
                size="sm"
                selected={identifyId === instance.id}
                title="La enciende 3 segundos para reconocerla"
                aria-label={`Identificar ${instance.label}`}
                onClick={() => identify(instance.id)}
              >
                Identificar
              </Button>
              <span className="font-mono text-text-secondary">
                {first}–{last}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[11px] text-text-secondary">
              {frame.slice(first - 1, last).map((value, i) => (
                <span key={i} title={`Canal ${first + i}`} className={value > 0 ? "text-accent" : undefined}>
                  {String(value).padStart(3, "0")}
                </span>
              ))}
            </div>
            {issues.map((issue) => (
              <p key={issue} className="mt-1 text-[11px] text-state-warn">
                ⚠ {issue}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
