import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { describePatch, universesOf } from "@/lib/dmxFrame";
import {
  ADAPTER_LABELS,
  DEFAULT_FPS,
  isNetwork,
  isUsb,
  useOutputFrame,
  type ArtNetNode,
  type DmxOutput,
} from "@/lib/dmxOutput";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { DmxAdapter, OutputStatus } from "@/types/engine";

const SPEEDS = [20, 25, 30, 35, 40];

const CHIP_LABELS = { ftdi: "FTDI", ch340: "CH340", other: "" } as const;

const selectClass =
  "h-9 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent";

/** Por dónde sale cada universo, y lo que está saliendo. */
export function DmxOutputView({ dmx }: { dmx: DmxOutput }) {
  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-80 shrink-0">
        <Panel title="SALIDAS">
          {dmx.available ? (
            <Outputs dmx={dmx} />
          ) : (
            <p className="text-xs text-text-secondary">
              En el navegador no hay salida DMX. Abre la app de escritorio de LUMEN PRO para
              conectar el adaptador.
            </p>
          )}
        </Panel>
      </div>
      <div className="min-w-0 flex-1">
        <OutputMonitor sent={dmx.available ? dmx.status.outputs.map((o) => o.config.universe) : null} />
      </div>
    </div>
  );
}

function Outputs({ dmx }: { dmx: DmxOutput }) {
  const { outputs, lastError } = dmx.status;
  const [adding, setAdding] = useState(false);
  const showForm = adding || outputs.length === 0;

  return (
    <div className="flex flex-col gap-3 text-xs text-text-secondary">
      {outputs.length === 0 ? <StatusIndicator status="danger" label="Sin conexión" /> : null}
      {outputs.map((o) => (
        <OutputCard key={o.config.id} output={o} onRemove={() => void dmx.remove(o.config.id)} />
      ))}
      {showForm ? (
        <NewOutput dmx={dmx} onDone={() => setAdding(false)} />
      ) : (
        <Button onClick={() => setAdding(true)}>+ Agregar salida</Button>
      )}
      {dmx.error ?? lastError ? (
        <p role="alert" className="text-state-danger">
          {dmx.error ?? lastError}
        </p>
      ) : null}
    </div>
  );
}

function OutputCard({ output, onRemove }: { output: OutputStatus; onRemove: () => void }) {
  const { config, state, name, fps, worstGapMs, lastError } = output;
  return (
    <div className="flex flex-col gap-1.5 rounded-control border border-border p-2.5">
      {state === "running" ? (
        <StatusIndicator status="ok" label={name} detail={`${fps} FPS`} />
      ) : (
        <StatusIndicator status="warn" label={name} detail="reconectando…" />
      )}
      <div className="flex items-center justify-between gap-2">
        <span>Universo {config.universe}</span>
        <span title="Desde que se conectó. A 30 FPS lo normal son unos 35 ms; más de 100 es un corte.">
          Pausa más larga: {worstGapMs} ms
        </span>
      </div>
      {lastError ? <p className="text-state-danger">{lastError}</p> : null}
      <Button size="sm" aria-label={`Desconectar ${name}`} onClick={onRemove}>
        Desconectar
      </Button>
    </div>
  );
}

function NewOutput({ dmx, onDone }: { dmx: DmxOutput; onDone: () => void }) {
  const [adapter, setAdapter] = useState<DmxAdapter>("open_dmx");
  const [chosenPort, setChosenPort] = useState<string | null>(null);
  const [universe, setUniverse] = useState(1);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [host, setHost] = useState("");
  // null = el que corresponde al universo del show.
  const [target, setTarget] = useState<number | null>(null);

  // Sin elección explícita (o si el puerto elegido desapareció), se propone
  // el primer FTDI: casi siempre es el único adaptador enchufado.
  const port =
    dmx.ports.find((p) => p.name === chosenPort) ?? dmx.ports.find((p) => p.chip === "ftdi") ?? dmx.ports[0];
  const usb = isUsb(adapter);
  // Art-Net cuenta desde 0 y sACN desde 1.
  const defaultTarget = adapter === "artnet" ? universe - 1 : universe;

  async function connect() {
    const ok = await dmx.add({
      adapter,
      universe,
      fps,
      port: usb ? (port?.name ?? "") : "",
      host: isNetwork(adapter) ? host.trim() : "",
      target: isNetwork(adapter) ? (target ?? defaultTarget) : 0,
    });
    if (ok) onDone();
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        Adaptador
        <select value={adapter} onChange={(e) => setAdapter(e.target.value as DmxAdapter)} className={selectClass}>
          {(Object.keys(ADAPTER_LABELS) as DmxAdapter[]).map((a) => (
            <option key={a} value={a}>
              {ADAPTER_LABELS[a]}
            </option>
          ))}
        </select>
      </label>

      {usb ? (
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

      {usb && port?.chip === "ch340" ? (
        <p className="text-state-warn">
          Este adaptador usa un chip CH340, no FTDI: es probable que las luces parpadeen.
        </p>
      ) : null}

      {isNetwork(adapter) ? (
        <>
          {adapter === "artnet" ? (
            <NodeFinder
              dmx={dmx}
              onPick={(ip, n) => {
                setHost(ip);
                setTarget(n);
              }}
            />
          ) : null}
          <label className="flex flex-col gap-1">
            IP del nodo
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder={adapter === "artnet" ? "Vacío = a toda la red" : "Vacío = multicast"}
              className={selectClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            Universo {adapter === "artnet" ? "Art-Net" : "sACN"}
            <input
              type="number"
              min={adapter === "artnet" ? 0 : 1}
              max={adapter === "artnet" ? 32767 : 63999}
              value={target ?? defaultTarget}
              onChange={(e) => setTarget(Number(e.target.value) || 0)}
              className={selectClass}
            />
          </label>
        </>
      ) : null}

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1">
          Universo del show
          <input
            type="number"
            min={1}
            value={universe}
            onChange={(e) => setUniverse(Math.max(1, Number(e.target.value) || 1))}
            className={selectClass}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          Velocidad
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className={selectClass}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} FPS
              </option>
            ))}
          </select>
        </label>
      </div>
      {usb ? <span className="text-[11px]">Si las luces parpadean, baja la velocidad.</span> : null}

      <Button variant="primary" size="lg" disabled={usb && !port} onClick={() => void connect()}>
        Conectar
      </Button>
      {dmx.status.outputs.length > 0 ? <Button onClick={onDone}>Cancelar</Button> : null}

      <p>
        {usb
          ? "Si el puerto aparece ocupado, cierra QLC+, FreeStyler u otro programa DMX: solo uno puede usarlo a la vez."
          : isNetwork(adapter)
            ? "La laptop y los nodos tienen que estar en la misma red. Por cable va mejor que por WiFi."
            : "Para ensayar sin cable: no sale nada, pero todo funciona igual."}
      </p>
    </div>
  );
}

function NodeFinder({ dmx, onPick }: { dmx: DmxOutput; onPick: (ip: string, universe: number) => void }) {
  const [nodes, setNodes] = useState<ArtNetNode[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    setSearching(true);
    setNodes(await dmx.findNodes());
    setSearching(false);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button loading={searching} onClick={() => void search()}>
        Buscar nodos en la red
      </Button>
      {nodes?.length === 0 ? (
        <p>Ningún nodo contestó. Revisa que esté encendido y en esta misma red; también puedes escribir su IP.</p>
      ) : null}
      {nodes?.flatMap((node) =>
        (node.universes.length > 0 ? node.universes : [0]).map((n) => (
          <Button key={`${node.ip}/${n}`} size="sm" onClick={() => onPick(node.ip, n)}>
            {node.name || node.ip} · universo {n}
          </Button>
        )),
      )}
    </div>
  );
}

function OutputMonitor({ sent }: { sent: number[] | null }) {
  const { instances, definitions, identifyId, identify } = useFixtureStore();
  const universes = universesOf(instances, sent ?? []);
  const [chosen, setChosen] = useState(1);
  const universe = universes.includes(chosen) ? chosen : universes[0];
  const frame = useOutputFrame(universe);
  const rows = describePatch(instances, definitions, sent).filter((r) => r.instance.universe === universe);

  return (
    <Panel title={`LO QUE SALE — UNIVERSO ${universe}`}>
      <div className="flex flex-col gap-2">
        {universes.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {universes.map((u) => (
              <Button key={u} size="sm" selected={u === universe} onClick={() => setChosen(u)}>
                Universo {u}
              </Button>
            ))}
          </div>
        ) : null}
        {rows.map(({ instance, first, last, issues }) => (
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
