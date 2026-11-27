import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { StageCanvas } from "@/components/stage/StageCanvas";
import { OutputPicker, formatTime } from "@/components/timeline/TimelineView";
import { cn } from "@/lib/utils";
import { askConfirm } from "@/lib/dialogs";
import { useFixtureStore } from "@/lib/fixtureStore";
import type { MusicPlayer } from "@/lib/musicPlayer";
import { PC_AUDIO, pcAudioAvailable } from "@/lib/pcAudio";
import type { AudioInput } from "@/lib/audioInput";
import { linkDetail, type LinkPlayer, type MusicLink } from "@/lib/links";
import type { MusicLights } from "@/lib/musicLights";
import { SoundTrack } from "./SoundTrack";
import { saveSong, songShape } from "@/lib/songs";
import type { PlaylistSong } from "@/types/music";

const songId = () => `song-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** La música de la hora loca, desde la laptop: cada canción viene con su
 *  ritmo analizado y las luces caen en cada golpe sin micrófono. */
export function MusicView({
  music,
  links,
  lights,
  audio,
}: {
  music: MusicPlayer;
  links: LinkPlayer;
  lights: MusicLights;
  audio: AudioInput;
}) {
  const store = useFixtureStore();
  const { playlist, addSongs, updateSong, removeSong, moveSong } = store;
  const [pending, setPending] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const current = playlist.find((s) => s.id === music.songId) ?? null;
  const opened = links.links.find((l) => l.id === links.openedId);
  // Qué está oyendo LUMEN: lo que dibuja la pista y siguen las luces.
  const hearing = music.playing
    ? "la canción que suena"
    : !audio.listening
      ? null
      : audio.deviceId === PC_AUDIO
        ? "lo que suena en esta PC"
        : "la entrada de audio (micrófono o cable)";

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
      <div className="flex w-[30rem] shrink-0 flex-col gap-2">
        <div className="min-h-0 flex-[2]">
          <Panel title="MÚSICA DE LA HORA LOCA">
            <p className="mb-3 text-xs text-text-secondary">
              La música sale de la laptop por el cable a la consola. Cada canción se analiza al agregarla: las luces que siguen la
              música caen en cada golpe, sin micrófono.
            </p>
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
        {pcAudioAvailable() ? (
          <div className="min-h-0 flex-[3]">
            <LinksPanel links={links} />
          </div>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="shrink-0">
          <Panel title="SUENA">
            {opened && !music.playing ? (
              <OpenedLink link={opened} links={links} />
            ) : (
            <>
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
              Si el tempo quedó al doble o a la mitad, corrígelo con ×2 o ½ en la canción; si no cae en el golpe, marca el
              ritmo con TAP. Al arrancar el vals, la música se pausa sola.
            </p>
            </>
            )}
            <LightsRow lights={lights} />
          </Panel>
        </div>
        <div className="shrink-0">
          <Panel title="PISTA">
            <SoundTrack hearing={hearing} />
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

/** El enlace que se abrió en el navegador. LUMEN no maneja esa ventana: la
 *  pausa y los saltos van por los controles multimedia de Windows (los que
 *  salen junto al volumen), que también dicen qué canción suena. */
function OpenedLink({ link, links }: { link: MusicLink; links: LinkPlayer }) {
  const now = links.now;
  const where = links.openedIn ?? "el navegador";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button aria-label="Anterior" onClick={() => links.media("previous")}>
          ⏮
        </Button>
        <Button variant="primary" onClick={() => links.media("playpause")}>
          {now && !now.playing ? "▶ Seguir" : "❚❚ Pausa"}
        </Button>
        <Button aria-label="Siguiente" onClick={() => links.media("next")}>
          ⏭
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={now?.title ?? link.title}>
          ♪ {now?.title || link.title}
          {now?.artist ? <span className="text-text-secondary"> · {now.artist}</span> : null}
        </span>
        <span className="shrink-0 text-xs text-text-secondary">
          {now ? (now.playing ? `suena en ${where}` : `en pausa en ${where}`) : `abierta en ${where}`}
        </span>
        <Button size="sm" variant="ghost" onClick={links.forget}>
          Usar mis canciones
        </Button>
      </div>
      {links.error ? (
        <p role="alert" className="mt-2 text-xs text-state-danger">
          {links.error}
        </p>
      ) : null}
      <p className="mt-2 text-[11px] text-text-secondary">
        Suena en una ventana de {where}: ahí puedes verla o cerrarla. Al arrancar el vals se pausa sola.
      </p>
    </>
  );
}

/** Si las luces siguen o no la música, y cómo hacer que la sigan. */
function LightsRow({ lights }: { lights: MusicLights }) {
  const name = lights.musicMoment?.name;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
      <span role="status" className={lights.following ? "font-medium text-accent" : "font-medium text-text-primary"}>
        {lights.following ? "💡 Las luces siguen la música" : "💡 Las luces no siguen la música"}
      </span>
      {!lights.following && name ? (
        <Button size="sm" variant="primary" onClick={lights.follow}>
          Que la sigan («{name}»)
        </Button>
      ) : null}
      {!name ? (
        <span className="text-text-secondary">Ningún momento tiene efectos al ritmo: arma uno en Momentos.</span>
      ) : (
        <label className="ml-auto flex items-center gap-1.5 text-text-secondary">
          <input
            type="checkbox"
            className="accent-accent"
            checked={lights.auto}
            onChange={(e) => lights.setAuto(e.target.checked)}
          />
          Al poner música, prender «{name}» si nada la sigue
        </label>
      )}
    </div>
  );
}

/** Canciones y playlists de YouTube o Spotify por enlace: se abren en el
 *  Brave del usuario y las luces las siguen sin guardar nada. */
function LinksPanel({ links }: { links: LinkPlayer }) {
  const [text, setText] = useState("");

  return (
    <Panel title="ENLACES DE YOUTUBE Y SPOTIFY">
      <p className="mb-3 text-xs text-text-secondary">
        Pega el enlace de una canción, álbum o playlist (en la app: Compartir → Copiar enlace). Con ▶ se abre en una
        ventana nueva de tu Brave (o de tu navegador) y sigue sola con la lista; las de Spotify se buscan en YouTube al
        agregarlas. Las luces la siguen escuchando lo que suena en esta PC (todo: otro video o un juego también), así que en el
        evento deja sonando solo la música. No se descarga nada: necesita internet.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void links.add(text).then((ok) => ok && setText(""));
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Enlace de YouTube o Spotify"
          placeholder="https://open.spotify.com/playlist/…"
          className="h-9 min-w-0 flex-1 rounded-control border border-border bg-panel2 px-2 text-sm text-text-primary outline-none"
        />
        <Button type="submit" variant="primary" disabled={links.busy || !text.trim()}>
          {links.busy ? "Leyendo…" : "Agregar"}
        </Button>
      </form>
      {links.busy ? (
        <p role="status" className="mt-2 text-xs text-text-secondary">
          Leyendo el enlace… una playlist de Spotify tarda unos segundos: se busca cada canción en YouTube.
        </p>
      ) : null}
      {links.error ? (
        <p role="alert" className="mt-2 text-xs text-state-danger">
          {links.error}
        </p>
      ) : null}

      <ol className="mt-3 flex flex-col gap-1.5" aria-label="Lista de enlaces">
        {links.links.map((link, index) => (
          <li
            key={link.id}
            className={cn(
              "flex items-center gap-2 rounded-control border px-2 py-1.5 text-sm",
              link.id === links.openedId ? "border-accent bg-accent/15" : "border-border bg-panel2",
            )}
          >
            <button
              type="button"
              aria-label={`Poner ${link.title}`}
              disabled={links.busy}
              onClick={() => links.play(link.id)}
              className="h-7 w-7 shrink-0 rounded-control text-text-primary hover:bg-panel disabled:opacity-40"
            >
              {link.id === links.openedId ? "♪" : "▶"}
            </button>
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: link.source === "youtube" ? "#ff0033" : "#1db954" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text-primary" title={link.title}>
                {link.title}
              </span>
              <span className="block truncate text-[11px] text-text-secondary">{linkDetail(link)}</span>
            </span>
            <RowButton label={`Subir ${link.title}`} disabled={index === 0} onClick={() => links.move(link.id, -1)}>
              ↑
            </RowButton>
            <RowButton
              label={`Bajar ${link.title}`}
              disabled={index === links.links.length - 1}
              onClick={() => links.move(link.id, 1)}
            >
              ↓
            </RowButton>
            <RowButton
              label={`Quitar ${link.title}`}
              onClick={() => askConfirm(`¿Quitar «${link.title}» de la lista?`, "Quitar", () => links.remove(link.id))}
            >
              ×
            </RowButton>
          </li>
        ))}
      </ol>
      {links.links.length === 0 ? <p className="mt-3 text-xs text-text-secondary">Todavía no hay enlaces.</p> : null}
    </Panel>
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
