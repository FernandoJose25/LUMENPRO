import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { useFixtureStore } from "@/lib/fixtureStore";
import { readSetting, writeSetting } from "@/lib/settings";

export type LinkSource = "youtube" | "spotify";
export type LinkKind = "video" | "playlist" | "track" | "album";

/** Un enlace de la lista de Música. Suena desde YouTube en el reproductor de
 *  LUMEN (src-tauri/src/links.rs); nada se descarga. */
export interface MusicLink {
  id: string;
  url: string;
  source: LinkSource;
  kind: LinkKind;
  title: string;
  /** Spotify: "artista canción" de cada una; se buscan en YouTube. */
  tracks: string[];
}

type Parsed = Pick<MusicLink, "url" | "source" | "kind">;

const YT_ID = /^[\w-]{6,64}$/;

function youtube(video: string | null, list: string | null): Parsed | null {
  if (list && !YT_ID.test(list)) list = null;
  if (video && YT_ID.test(video)) {
    return list
      ? {
          source: "youtube",
          kind: "playlist",
          url: `https://www.youtube.com/watch?v=${video}&list=${list}`,
        }
      : {
          source: "youtube",
          kind: "video",
          url: `https://www.youtube.com/watch?v=${video}`,
        };
  }
  return list
    ? {
        source: "youtube",
        kind: "playlist",
        url: `https://www.youtube.com/playlist?list=${list}`,
      }
    : null;
}

/** Entiende los enlaces de "Compartir → Copiar enlace" de YouTube y Spotify. */
export function parseLink(text: string): Parsed | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const list = url.searchParams.get("list");
  if (host === "youtu.be") return youtube(url.pathname.slice(1).split("/")[0], list);
  if (host === "youtube.com") {
    if (url.pathname === "/watch") return youtube(url.searchParams.get("v"), list);
    if (url.pathname === "/playlist") return youtube(null, list);
    const short = url.pathname.match(/^\/(?:shorts|live)\/([\w-]+)/);
    return short ? youtube(short[1], null) : null;
  }
  if (host === "open.spotify.com") {
    const m = url.pathname.match(/^\/(?:intl-[\w-]+\/)?(track|album|playlist)\/([A-Za-z0-9]+)/);
    return m
      ? {
          source: "spotify",
          kind: m[1] as LinkKind,
          url: `https://open.spotify.com/${m[1]}/${m[2]}`,
        }
      : null;
  }
  return null;
}

/** La página de YouTube que suena para ese enlace (y esa canción, si es de Spotify). */
export function playerUrl(link: MusicLink, track: number): string {
  if (link.source === "spotify") {
    const search = `${link.tracks[track] ?? link.title} audio`;
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(search)}&lumen=1`;
  }
  return link.url.includes("/playlist?") ? `${link.url}&lumen=1` : link.url;
}

const KINDS: Record<LinkKind, string> = {
  video: "video",
  playlist: "playlist",
  track: "canción",
  album: "álbum",
};

/** "Spotify · playlist · 50 canciones". */
export function linkDetail(link: MusicLink): string {
  const source = link.source === "youtube" ? "YouTube" : "Spotify";
  const count = link.tracks.length > 1 ? ` · ${link.tracks.length} canciones` : "";
  return `${source} · ${KINDS[link.kind]}${count}`;
}

const linkId = () => `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

type PlayerEvent = { title: string } | { ended: true } | { closed: true };

export interface LinkPlaying {
  id: string;
  /** La canción dentro de un enlace de Spotify. */
  track: number;
  /** El título del video que suena, cuando YouTube lo dice. */
  title: string | null;
  paused: boolean;
}

export interface LinkPlayer {
  links: MusicLink[];
  playing: LinkPlaying | null;
  busy: boolean;
  error: string | null;
  add: (text: string) => Promise<boolean>;
  remove: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  play: (id: string, track?: number) => void;
  toggle: () => void;
  next: () => void;
  stop: () => void;
}

/**
 * Los enlaces de YouTube y Spotify de Música. Se monta una sola vez (AppShell):
 * sigue sonando al cambiar de sección, pasa solo a la siguiente canción y se
 * pausa si arranca el vals. `onStart` se llama al poner un enlace.
 */
export function useLinkPlayer(onStart: () => void): LinkPlayer {
  const { timeline } = useFixtureStore();
  const [links, setLinks] = useState<MusicLink[]>(() => readSetting<MusicLink[]>("music.links") ?? []);
  const [playing, setPlaying] = useState<LinkPlaying | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linksRef = useRef(links);
  const playingRef = useRef(playing);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const show = useCallback((next: LinkPlaying | null) => {
    playingRef.current = next;
    setPlaying(next);
  }, []);

  const save = useCallback((update: (list: MusicLink[]) => MusicLink[]) => {
    linksRef.current = update(linksRef.current);
    setLinks(linksRef.current);
    writeSetting("music.links", linksRef.current);
  }, []);

  const stop = useCallback(() => {
    if (!playingRef.current) return;
    show(null);
    void invoke("player_control", { action: "stop" }).catch(() => {});
  }, [show]);

  const play = useCallback(
    (id: string, track = 0) => {
      const link = linksRef.current.find((l) => l.id === id);
      if (!link) return;
      setError(null);
      onStartRef.current();
      show({ id, track, title: null, paused: false });
      invoke("player_play", { url: playerUrl(link, track) }).catch((e) => {
        show(null);
        setError(String(e));
      });
    },
    [show],
  );

  /** La siguiente canción: dentro del enlace de Spotify, o el próximo enlace. */
  const advance = useCallback(() => {
    const now = playingRef.current;
    if (!now) return;
    const list = linksRef.current;
    const index = list.findIndex((l) => l.id === now.id);
    const link = list[index];
    if (link?.source === "spotify" && now.track + 1 < link.tracks.length) return play(link.id, now.track + 1);
    const after = list[index + 1];
    if (after) play(after.id);
    else stop();
  }, [play, stop]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    if (!isTauri()) return;
    const onEvent = new Channel<PlayerEvent>();
    onEvent.onmessage = (event) => {
      const now = playingRef.current;
      if ("title" in event) {
        if (now) show({ ...now, title: event.title });
      } else if ("ended" in event) advanceRef.current();
      else show(null);
    };
    void invoke("player_attach", { onEvent });
  }, [show]);

  const setPaused = useCallback(
    (paused: boolean) => {
      const now = playingRef.current;
      if (!now || now.paused === paused) return;
      show({ ...now, paused });
      void invoke("player_control", { action: paused ? "pause" : "play" });
    },
    [show],
  );

  // El vals manda: si arranca una línea de tiempo, el enlace se pausa.
  const timelinePlaying = timeline !== null && timeline.pausedAt === null;
  useEffect(() => {
    if (timelinePlaying) setPaused(true);
  }, [timelinePlaying, setPaused]);

  const add = useCallback(
    async (text: string) => {
      const parsed = parseLink(text);
      if (!parsed) {
        setError("Ese enlace no es de YouTube ni de Spotify. En la app toca Compartir → Copiar enlace y pégalo aquí.");
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const info = await invoke<{ title: string | null; tracks: string[] }>("link_info", { url: parsed.url });
        const title = info.title ?? (parsed.kind === "playlist" ? "Playlist de YouTube" : "Video de YouTube");
        save((list) => [...list, { id: linkId(), ...parsed, title, tracks: info.tracks }]);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [save],
  );

  const remove = useCallback(
    (id: string) => {
      if (playingRef.current?.id === id) stop();
      save((list) => list.filter((l) => l.id !== id));
    },
    [save, stop],
  );

  const move = useCallback(
    (id: string, direction: -1 | 1) =>
      save((list) => {
        const from = list.findIndex((l) => l.id === id);
        const to = from + direction;
        if (from < 0 || to < 0 || to >= list.length) return list;
        const next = [...list];
        [next[from], next[to]] = [next[to], next[from]];
        return next;
      }),
    [save],
  );

  const toggle = useCallback(() => setPaused(!playingRef.current?.paused), [setPaused]);

  const next = useCallback(() => {
    const now = playingRef.current;
    const link = now && linksRef.current.find((l) => l.id === now.id);
    if (link?.source === "youtube" && link.kind === "playlist") void invoke("player_control", { action: "next" });
    else advance();
  }, [advance]);

  return {
    links,
    playing,
    busy,
    error,
    add,
    remove,
    move,
    play,
    toggle,
    next,
    stop,
  };
}
