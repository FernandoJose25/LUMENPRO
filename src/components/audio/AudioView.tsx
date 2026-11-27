import { useEffect, useRef } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Fader } from "@/components/ui/Fader";
import { BAND_NAMES, getAudioFeed, type AudioInput, type Band } from "@/lib/audioInput";
import { useFixtureStore } from "@/lib/fixtureStore";
import { EFFECT_SOURCE_LABELS } from "@/types/effect";
import { VirtualDj } from "./VirtualDj";

const BAND_LABELS: Record<Band, string> = { bass: "Graves", mid: "Medios", treble: "Agudos" };

/** Escuchar la música para que los effects la sigan (ver Effect.source). */
export function AudioView({ audio }: { audio: AudioInput }) {
  const { effects } = useFixtureStore();
  const followers = effects.filter((fx) => fx.source !== "clock");

  return (
    <div className="flex min-w-0 flex-1 gap-2 overflow-y-auto p-2">
      <div className="min-w-0 max-w-2xl flex-1">
        <Panel title="AUDIO REACTIVE">
          <div className="flex items-center gap-3">
            <Button
              size="lg"
              variant={audio.listening ? "danger" : "primary"}
              onClick={() => (audio.listening ? audio.stop() : void audio.start())}
            >
              {audio.listening ? "■ Dejar de escuchar" : "▶ Escuchar"}
            </Button>
            <span role="status" className="text-sm text-text-primary">
              {!audio.listening
                ? "Sin escuchar"
                : audio.bpm !== null
                  ? `${audio.bpm} BPM`
                  : audio.musicOnly
                    ? "Buscando el ritmo… (unos 5 segundos; mientras, los PAR al ritmo siguen apagados)"
                    : "Buscando el ritmo… (tarda unos 5 segundos)"}
            </span>
          </div>
          <p className="mt-3 text-xs text-text-secondary">
            ¿No oye bien o no hay cómo conectar nada? Toca <b className="text-text-primary">TAP</b> arriba (o la tecla T) al
            ritmo de la canción, un toque por golpe: las luces siguen ese ritmo hasta que lo sueltes con ×.
          </p>
          {audio.error ? (
            <p role="alert" className="mt-3 text-xs text-state-danger">
              {audio.error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1 text-text-secondary">
              Entrada de audio
              <select
                value={audio.deviceId}
                onChange={(e) => audio.setDeviceId(e.target.value)}
                className="h-9 rounded-control border border-border bg-panel2 px-2 text-text-primary outline-none"
              >
                <option value="">Predeterminada de Windows</option>
                {audio.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <Fader label="Sensibilidad" value={audio.sensitivity} max={100} onChange={audio.setSensitivity} />
            <label className="flex items-start gap-2 text-text-primary">
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={audio.musicOnly}
                onChange={(e) => audio.setMusicOnly(e.target.checked)}
              />
              <span>
                Solo con música (para los discursos)
                <span className="block text-[11px] text-text-secondary">
                  Sin marcar, cualquier sonido prende lo que sigue a los graves, medios o agudos, también la voz.
                  Marcado, espera a reconocer el ritmo de una canción: los discursos y el ruido no prenden nada.
                </span>
              </span>
            </label>
          </div>

          <Meters listening={audio.listening} />

          <p className="mt-4 border-t border-border pt-3 text-[11px] text-text-secondary">
            Lo mejor es un cable de la salida REC o AUX de la consola de sonido a la entrada de la laptop. Con el
            micrófono también sirve. Si las barras se mueven en silencio, baja la sensibilidad; si no se mueven con
            música, súbela.
          </p>
        </Panel>
      </div>

      <div className="flex w-96 shrink-0 flex-col gap-2">
        <div className="shrink-0">
          <VirtualDj />
        </div>
        <Panel title="EFFECTS QUE SIGUEN LA MÚSICA">
          {followers.length === 0 ? (
            <p className="text-xs text-text-secondary">
              Ninguno todavía. En Effects, cambia “Sigue a” por el ritmo o por una parte del sonido. La plantilla de
              quinceañera ya trae el momento “Hora loca con música”.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {followers.map((fx) => (
                <li key={fx.id} className="flex justify-between gap-2 rounded-control border border-border px-2.5 py-1.5">
                  <span className="truncate text-text-primary">{fx.name}</span>
                  <span className="shrink-0 text-text-secondary">{EFFECT_SOURCE_LABELS[fx.source]}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-text-secondary">
            Sin música (o sin escuchar), los que siguen a los graves, medios o agudos se quedan en su mínimo: con
            mínimo 0, apagados. Los que siguen el ritmo siguen con su velocidad normal.
          </p>
        </Panel>
      </div>
    </div>
  );
}

/** Se dibuja sin pasar por React: se mueve 60 veces por segundo. */
function Meters({ listening }: { listening: boolean }) {
  const bars = useRef<Partial<Record<Band, HTMLDivElement | null>>>({});
  const beat = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!listening) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const feed = getAudioFeed();
      const beats = feed?.beats() ?? null;
      for (const band of BAND_NAMES) {
        const bar = bars.current[band];
        if (bar) bar.style.width = `${(feed?.levels[band] ?? 0) * 100}%`;
      }
      if (beat.current) beat.current.style.opacity = String(beats === null ? 0.1 : Math.max(0.1, 1 - (beats % 1) * 2));
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [listening]);

  if (!listening) return null;
  return (
    <div className="mt-4 flex items-center gap-4">
      <span ref={beat} className="h-12 w-12 shrink-0 rounded-full bg-accent opacity-10" aria-hidden />
      <div className="flex flex-1 flex-col gap-2">
        {BAND_NAMES.map((band) => (
          <div key={band} className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="w-14">{BAND_LABELS[band]}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel2">
              <div ref={(el) => (bars.current[band] = el)} className="h-full rounded-full bg-accent" style={{ width: 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
