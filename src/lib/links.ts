import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFixtureStore } from "@/lib/fixtureStore";
import { readSetting, writeSetting } from "@/lib/settings";

export type LinkSource = "youtube" | "spotify";
export type LinkKind = "video" | "playlist" | "track" | "album";

/** Un enlace de la lista de Música. Suena en una ventana nueva del Brave del
 *  usuario (o en su navegador): src-tauri/src/links.rs. Nada se descarga. */
export interface MusicLink {
  id: string;
  url: string;
  source: LinkSource;
  kind: LinkKind;
  title: string;
  /** Spotify: "artista canción" de cada una. */
  tracks: string[];
  /** Spotify: el video de YouTube de cada canción (null si no se encontró). */
  videos?: (string | null)[];
}

type Parsed = Pick<MusicLink, "url" | "source" | "kind">;

const YT_ID = /^[\w-]{6,64}$/;

function youtube(video: string | null, list: string | null): Parsed | null {
  if (list && !YT_ID.test(list)) list = null;
  if (video && YT_ID.test(video)) {
    return list
      ? { source: "youtube", kind: "playlist", url: `https://www.youtube.com/watch?v=${video}&list=${list}` }
      : { source: "youtube", kind: "video", url: `https://www.youtube.com/watch?v=${video}` };
  }
  return list ? { source: "youtube", kind: "playlist", url: `https://www.youtube.com/playlist?list=${list}` } : null;
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
    return m ? { source: "spotify", kind: m[1] as LinkKind, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
  }
  return null;
}

/** YouTube arma una lista con hasta 50 videos y los pasa uno tras otro. */
const MAX_VIDEOS = 50;

/** Lo que se abre en el navegador: el enlace de YouTube tal cual; de Spotify,
 *  sus canciones en YouTube (una sola, o la lista que arma YouTube). */
export function browserUrl(link: MusicLink): string | null {
  if (link.source === "youtube") return link.url;
  const ids = (link.videos ?? []).filter((v): v is string => !!v && YT_ID.test(v)).slice(0, MAX_VIDEOS);
  if (ids.length === 0) return null;
  if (ids.length === 1) return `https://www.youtube.com/watch?v=${ids[0]}`;
  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
}

const KINDS: Record<LinkKind, string> = { video: "video", playlist: "playlist", track: "canción", album: "álbum" };

/** "Spotify · playlist · 50 canciones". */
export function linkDetail(link: MusicLink): string {
  const source = link.source === "youtube" ? "YouTube" : "Spotify";
  const count = link.tracks.length > 1 ? ` · ${link.tracks.length} canciones` : "";
  return `${source} · ${KINDS[link.kind]}${count}`;
}

const linkId = () => `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface NowPlaying {
  title: string;
  artist: string;
  playing: boolean;
}

export interface LinkPlayer {
  links: MusicLink[];
  /** El último enlace que se abrió (sigue sonando en el navegador hasta que lo pares ahí). */
  openedId: string | null;
  /** "Brave" o "tu navegador": dónde se abrió. */
  openedIn: string | null;
  busy: boolean;
  error: string | null;
  add: (text: string) => Promise<boolean>;
  remove: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  play: (id: string) => void;
  /** Lo que suena en el navegador según Windows (cada 2 s mientras hay un enlace abierto). */
  now: NowPlaying | null;
  /** Pausa, sigue o cambia de canción en el navegador (controles multimedia de Windows). */
  media: (action: "playpause" | "next" | "previous") => void;
  forget: () => void;
}

/**
 * Los enlaces de YouTube y Spotify de Música. ▶ abre el enlace en una ventana
 * nueva del Brave del usuario; desde ahí YouTube sigue solo con la lista.
 * `onStart` se llama al abrir un enlace, con dónde se abrió (las luces pasan a escuchar ese programa).
 */
export function useLinkPlayer(onStart: (openedIn: string) => void): LinkPlayer {
  const [links, setLinks] = useState<MusicLink[]>(() => readSetting<MusicLink[]>("music.links") ?? []);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [openedIn, setOpenedIn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linksRef = useRef(links);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const save = useCallback((update: (list: MusicLink[]) => MusicLink[]) => {
    linksRef.current = update(linksRef.current);
    setLinks(linksRef.current);
    writeSetting("music.links", linksRef.current);
  }, []);

  const play = useCallback(
    async (id: string) => {
      let link = linksRef.current.find((l) => l.id === id);
      if (!link) return;
      setError(null);
      // Un enlace de Spotify guardado antes de buscar sus videos: se buscan ahora.
      if (link.source === "spotify" && !link.videos) {
        setBusy(true);
        try {
          const info = await invoke<{ videos: (string | null)[] }>("link_info", { url: link.url });
          const videos = info.videos;
          save((list) => list.map((l) => (l.id === id ? { ...l, videos } : l)));
          link = { ...link, videos };
        } catch (e) {
          setError(String(e));
          return;
        } finally {
          setBusy(false);
        }
      }
      const url = browserUrl(link);
      if (!url) {
        setError(`No encontré «${link.title}» en YouTube. Quítalo y vuelve a agregarlo.`);
        return;
      }
      try {
        const where = await invoke<string>("open_in_browser", { url });
        setOpenedId(id);
        setOpenedIn(where);
        onStartRef.current(where);
      } catch (e) {
        setError(String(e));
      }
    },
    [save],
  );

  const [now, setNow] = useState<NowPlaying | null>(null);
  const readNow = useCallback(() => {
    invoke<NowPlaying | null>("media_now")
      .then(setNow)
      .catch(() => setNow(null));
  }, []);
  useEffect(() => {
    if (!openedId) {
      setNow(null);
      return;
    }
    readNow();
    const timer = setInterval(readNow, 2000);
    return () => clearInterval(timer);
  }, [openedId, readNow]);

  const media = useCallback(
    (action: "playpause" | "next" | "previous") => {
      setError(null);
      invoke("media_control", { action })
        .then(() => setTimeout(readNow, 400))
        .catch((e) => setError(String(e)));
    },
    [readNow],
  );

  // El vals manda: si arranca una línea de tiempo, la música del navegador se pausa.
  const { timeline } = useFixtureStore();
  const timelinePlaying = timeline !== null && timeline.pausedAt === null;
  useEffect(() => {
    if (timelinePlaying && openedId) invoke("media_control", { action: "pause" }).catch(() => {});
  }, [timelinePlaying, openedId]);

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
        const info = await invoke<{ title: string | null; tracks: string[]; videos: (string | null)[] }>("link_info", {
          url: parsed.url,
        });
        const title = info.title ?? (parsed.kind === "playlist" ? "Playlist de YouTube" : "Video de YouTube");
        const videos = parsed.source === "spotify" ? info.videos : undefined;
        save((list) => [...list, { id: linkId(), ...parsed, title, tracks: info.tracks, videos }]);
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
      if (id === openedId) setOpenedId(null);
      save((list) => list.filter((l) => l.id !== id));
    },
    [save, openedId],
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

  const forget = useCallback(() => setOpenedId(null), []);

  return { links, openedId, openedIn, now, busy, error, add, remove, move, play: (id) => void play(id), media, forget };
}
