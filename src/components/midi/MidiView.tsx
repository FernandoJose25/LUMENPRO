import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { actionLabel, actionOptions } from "@/lib/actions";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { Action, Control } from "@/types/controls";

interface Heard {
  device: string;
  kind: "note" | "cc";
  channel: number;
  number: number;
  value: number;
  seq: number;
}

interface MidiStatus {
  devices: string[];
  last: Heard | null;
}

const POLL_MS = 150;

export const describeControl = (c: Pick<Control, "kind" | "channel" | "number">) =>
  `${c.kind === "note" ? "Botón (nota)" : "Fader o perilla (CC)"} ${c.number} · canal ${c.channel + 1}`;

/** Controladores MIDI: asignar un botón o fader moviéndolo. */
export function MidiView() {
  const store = useFixtureStore();
  const { engine, controls, setControls } = store;
  const [status, setStatus] = useState<MidiStatus>({ devices: [], last: null });
  const [learning, setLearning] = useState<Action | null>(null);
  const [anyDevice, setAnyDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenSeq = useRef<number | null>(null);
  const options = actionOptions(store);
  const [chosen, setChosen] = useState(options[0]?.key ?? "");

  useEffect(() => {
    if (!engine.desktop) return;
    let stop = false;
    const poll = async () => {
      try {
        const next = await engine.request<MidiStatus>({ cmd: "midiStatus" });
        if (!stop) setStatus(next);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [engine]);

  // Aprender: el primer mensaje que llegue después de pedirlo.
  useEffect(() => {
    const heard = status.last;
    if (!learning || !heard || heard.seq === seenSeq.current) return;
    seenSeq.current = heard.seq;
    const control: Control = {
      id: `midi-${crypto.randomUUID()}`,
      device: anyDevice ? "" : heard.device,
      kind: heard.kind,
      channel: heard.channel,
      number: heard.number,
      action: learning,
    };
    const same = (c: Control) =>
      c.device === control.device && c.kind === control.kind && c.channel === control.channel && c.number === control.number;
    setControls([...controls.filter((c) => !same(c)), control]);
    setLearning(null);
  }, [status.last, learning, anyDevice, controls, setControls]);

  if (!engine.desktop) {
    return (
      <div className="min-w-0 flex-1 p-2">
        <Panel title="MIDI">
          <p className="text-xs text-text-secondary">Los controladores MIDI funcionan en la app de escritorio.</p>
        </Panel>
      </div>
    );
  }

  function learn() {
    const option = options.find((o) => o.key === chosen);
    if (!option) return;
    seenSeq.current = status.last?.seq ?? null;
    setLearning(option.action);
  }

  const groups = [...new Set(options.map((o) => o.group))];

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="w-80 shrink-0">
        <Panel title="CONTROLADORES">
          <div className="flex flex-col gap-2 text-xs text-text-secondary">
            {status.devices.length === 0 ? (
              <p>Ninguno enchufado. Se detectan solos al conectarlos por USB.</p>
            ) : (
              status.devices.map((d) => (
                <p key={d} className="font-medium text-text-primary">
                  {d}
                </p>
              ))
            )}
            <p className="border-t border-border pt-2" role="status">
              {status.last
                ? `Último: ${status.last.device} · ${describeControl(status.last)} · valor ${status.last.value}`
                : "Mueve algo del controlador para verlo aquí."}
            </p>
            {error ? (
              <p role="alert" className="text-state-danger">
                {error}
              </p>
            ) : null}
            <p className="border-t border-border pt-2">
              Funcionan aunque la ventana esté cerrada. Los botones que encienden luces (momentos, effects, Blackout)
              se iluminan en el controlador si este lo permite.
            </p>
          </div>
        </Panel>
      </div>
      <div className="min-w-0 flex-1">
        <Panel title="ASIGNACIONES">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <select
              aria-label="Qué hará el control"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
            >
              {groups.map((group) => (
                <optgroup key={group} label={group}>
                  {options
                    .filter((o) => o.group === group)
                    .map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-text-secondary">
              <input type="checkbox" checked={anyDevice} onChange={(e) => setAnyDevice(e.target.checked)} className="accent-accent" />
              De cualquier controlador
            </label>
            {learning ? (
              <Button variant="danger" onClick={() => setLearning(null)}>
                Mueve el botón o fader… (cancelar)
              </Button>
            ) : (
              <Button variant="primary" onClick={learn} disabled={!chosen}>
                Aprender
              </Button>
            )}
          </div>
          {controls.length === 0 ? (
            <p className="text-xs text-text-secondary">
              Elige qué hará, toca “Aprender” y mueve el botón o fader del controlador.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {controls.map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-control border border-border px-3 py-2">
                  <span className="w-40 shrink-0 truncate text-text-secondary">{c.device || "Cualquiera"}</span>
                  <span className="w-56 shrink-0 text-text-secondary">{describeControl(c)}</span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{actionLabel(c.action, store)}</span>
                  <Button size="sm" variant="ghost" aria-label={`Quitar ${describeControl(c)}`} onClick={() => setControls(controls.filter((x) => x.id !== c.id))}>
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
