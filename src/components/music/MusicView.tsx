import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { OutputPicker, formatTime } from "@/components/timeline/TimelineView";
import { cn } from "@/lib/utils";
import { askConfirm } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { MusicPlayer } from "@/lib/musicPlayer";
import { pcAudioAvailable } from "@/lib/pcAudio";
import { saveSong, songShape } from "@/lib/songs";
import type { PlaylistSong } from "@/types/music";

const songId = () => `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** La música de la hora loca, desde la laptop: cada canción viene con su
 *  ritmo analizado y las luces caen en cada golpe sin micrófono. */
export function MusicView({ music }: { music: MusicPlayer }) {
  const store = useFixtureStore();
  const { playlist, addSongs, updateSong, removeSong, moveSong } = store;
  const [pending, setPending] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const current = playlist.find((s) => s.id === music.songId) ?? null;

  async function handleFiles(files: File[]) {
    setFailed([]);
    setPending((p) => [...p, ...files.map((f) => f.name)]);
    for (const file of files) {
      try {
        const saved = await saveSong(file);
        const shape = await songShape(saved);
        const song: PlaylistSong = {
          id: songId(),
          ...saved,
          durationMs: shape.durationMs,
          bpm: shape.grid?.bpm ?? null,
          firstBeatMs: shape.grid?.firstBeatMs ?? 0,
        };
        addSongs([song]);
      } catch {
        setFailed((f) => [...f, file.name]);
      } finally {
        setPending((p) => p.filter((name, i) => name !== file.name || i !== p.indexOf(file.name)));
      }
    }
  }

  return (
    <div className="flex min-w-0 flex-1 gap-2 p-2">
      <div className="flex w-[30rem] shrink-0 flex-col">
        <Panel title="MÚSICA DE LA HORA LOCA">
          <p className="mb-3 text-xs text-text-secondary">
            La música sale de la laptop por el cable a la consola. Cada canción se analiza al agregarla: las luces que siguen la
            música caen en cada golpe, sin micrófono.
          </p>
          {pcAudioAvailable() ? (
            <p className="mb-3 text-xs text-text-secondary">
              ¿Sin descargar canciones? Pon la música en Spotify o YouTube en esta laptop y en Audio Reactive elige{" "}
              <b className="text-text-primary">Lo que suena en esta PC</b>: las luces siguen los graves igual, sin guardar
              nada. Lo único que no hay es el análisis previo de cada canción.
            </p>
          ) : null}
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control bg-accent px-3.5 text-sm font-medium text-bg hover:bg-accent/90">
            + Agregar canciones
            <input
              type="file"
              multiple
              accept="audio/*,.mp3,.m4a,.wav,.ogg"
              aria-label="Canciones"
              className="sr-only"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length > 0) void handleFiles(files);
              }}
            />
          </label>
          {pending.length > 0 ? (
            <p role="status" className="mt-2 text-xs text-text-secondary">
              Analizando {pending.join(", ")}…
            </p>
          ) : null}
          {failed.length > 0 ? (
            <p role="alert" className="mt-2 text-xs text-state-danger">
              No pude leer {failed.join(", ")}. Prueba con un MP3.
            </p>
          ) : null}

          <ol className="mt-3 flex flex-col gap-1.5" aria-label="Lista de canciones">
            {playlist.map((song, index) => (
              <li
                key={song.id}
                className={cn(
                  "flex items-center gap-2 rounded-control border px-2 py-1.5 text-sm",
                  song.id === music.songId ? "border-accent bg-accent/15" : "border-border bg-panel2",
                )}
              >
                <button
                  type="button"
                  aria-label={`Poner ${song.name}`}
                  onClick={() => music.play(song.id)}
                  className="h-7 w-7 shrink-0 rounded-control text-text-primary hover:bg-panel"
                >
                  {song.id === music.songId && music.playing ? "♪" : "▶"}
                </button>
                <span className="min-w-0 flex-1 truncate text-text-primary" title={song.name}>
                  {song.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-text-secondary">{formatTime(song.durationMs).replace(/\.\d$/, "")}</span>
                <Tempo song={song} onChange={(bpm) => updateSong(song.id, { bpm })} />
                <RowButton label={`Subir ${song.name}`} disabled={index === 0} onClick={() => moveSong(song.id, -1)}>
                  ↑
                </RowButton>
                <RowButton label={`Bajar ${song.name}`} disabled={index === playlist.length - 1} onClick={() => moveSong(song.id, 1)}>
                  ↓
                </RowButton>
                <RowButton
                  label={`Quitar ${song.name}`}
                  onClick={() => askConfirm(`¿Quitar «${song.name}» de la lista?`, "Quitar", () => removeSong(song.id))}
                >
                  ×
                </RowButton>
              </li>
            ))}
          </ol>
          {playlist.length === 0 && pending.length === 0 ? (
            <p className="mt-3 text-xs text-text-secondary">Todavía no hay canciones.</p>
          ) : null}
        </Panel>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="shrink-0">
          <Panel title="SUENA">
            <div className="flex flex-wrap items-center gap-2">
              <Button aria-label="Anterior" onClick={music.prev} disabled={playlist.length === 0}>
                ⏮
              </Button>
              <Button variant="primary" onClick={music.toggle} disabled={playlist.length === 0}>
                {music.playing ? "❚❚ Pausa" : "▶ Reproducir"}
              </Button>
              <Button aria-label="Siguiente" onClick={music.next} disabled={playlist.length === 0}>
                ⏭
              </Button>
              <span className="min-w-0 truncate text-sm text-text-primary">{current ? current.name : "—"}</span>
              {current?.bpm ? <span className="font-mono text-xs text-accent">{Math.round(current.bpm)} BPM</span> : null}
              <OutputPicker />
            </div>
            {current ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="w-12 font-mono text-xs text-text-secondary">{formatTime(music.positionMs).replace(/\.\d$/, "")}</span>
                <input
                  type="range"
                  aria-label="Posición en la canción"
                  min={0}
                  max={Math.max(1, current.durationMs)}
                  step={500}
                  value={Math.min(music.positionMs, current.durationMs)}
                  onChange={(e) => music.seek(Number(e.target.value))}
                  className="min-w-0 flex-1 accent-[var(--accent,#a78bfa)]"
                />
                <span className="w-12 font-mono text-xs text-text-secondary">{formatTime(current.durationMs).replace(/\.\d$/, "")}</span>
              </div>
            ) : null}
            {music.error ? (
              <p role="alert" className="mt-2 text-xs text-state-danger">
                {music.error}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-text-secondary">
              Lanza «Hora loca con música» (o cualquier momento con efectos al ritmo). Si el tempo quedó al doble o a la mitad,
              corrígelo con ×2 o ½ en la canción; si no cae en el golpe, marca el ritmo con TAP. Al arrancar el vals, la música
              se pausa sola.
            </p>
          </Panel>
        </div>
        <div className="min-h-0 flex-1">
          <Panel title="SIMULADOR">
            <StageCanvas rig={store} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** El tempo encontrado, y cómo corregirlo si quedó al doble o a la mitad. */
function Tempo({ song, onChange }: { song: PlaylistSong; onChange: (bpm: number) => void }) {
  if (!song.bpm) return <span className="shrink-0 text-[11px] text-text-secondary">sin ritmo</span>;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <span className="w-14 text-right font-mono text-[11px] text-text-secondary">{Math.round(song.bpm)} BPM</span>
      <RowButton label={`Mitad del tempo de ${song.name}`} onClick={() => onChange(song.bpm! / 2)}>
        ½
      </RowButton>
      <RowButton label={`Doble del tempo de ${song.name}`} onClick={() => onChange(song.bpm! * 2)}>
        ×2
      </RowButton>
    </span>
  );
}

function RowButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-6 min-w-6 rounded-control px-1 text-xs text-text-secondary hover:bg-panel hover:text-text-primary disabled:opacity-30"
    >
      {children}
    </button>
  );
}
