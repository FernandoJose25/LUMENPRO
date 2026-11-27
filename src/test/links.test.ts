import { describe, it, expect } from "vitest";
import { linkDetail, parseLink, playerUrl, type MusicLink } from "@/lib/links";

describe("Enlaces de YouTube y Spotify", () => {
  it.each([
    ["https://youtu.be/kJQP7kiw5Fk?si=abc123", "video", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"],
    ["https://www.youtube.com/watch?v=kJQP7kiw5Fk&t=30s", "video", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"],
    ["https://m.youtube.com/watch?v=kJQP7kiw5Fk", "video", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"],
    ["https://music.youtube.com/watch?v=kJQP7kiw5Fk&si=x", "video", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"],
    ["https://youtube.com/shorts/kJQP7kiw5Fk", "video", "https://www.youtube.com/watch?v=kJQP7kiw5Fk"],
    [
      "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
      "playlist",
      "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    ],
    [
      "https://www.youtube.com/watch?v=kJQP7kiw5Fk&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI&index=2",
      "playlist",
      "https://www.youtube.com/watch?v=kJQP7kiw5Fk&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    ],
  ])("YouTube: %s", (text, kind, url) => {
    expect(parseLink(text)).toEqual({ source: "youtube", kind, url });
  });

  it.each([
    [
      "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl?si=4f2",
      "track",
      "https://open.spotify.com/track/11dFghVXANMlKmJXsNCbNl",
    ],
    [
      "https://open.spotify.com/intl-es/album/4aawyAB9vmqN3uQ7FjRGTy",
      "album",
      "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy",
    ],
    [
      "  https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=a  ",
      "playlist",
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    ],
  ])("Spotify: %s", (text, kind, url) => {
    expect(parseLink(text)).toEqual({ source: "spotify", kind, url });
  });

  it.each([
    "hola",
    "https://example.com/watch?v=kJQP7kiw5Fk",
    "https://open.spotify.com/artist/6sFIWsNpZYqfjUpaCgueju",
    "https://www.youtube.com/",
  ])("no acepta %s", (text) => {
    expect(parseLink(text)).toBeNull();
  });

  const link = (patch: Partial<MusicLink>): MusicLink => ({
    id: "l",
    url: "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
    source: "youtube",
    kind: "video",
    title: "Despacito",
    tracks: [],
    ...patch,
  });

  it("una canción de Spotify se busca en YouTube por artista y nombre", () => {
    const spotify = link({
      source: "spotify",
      kind: "playlist",
      tracks: ["KAROL G Tusa", "Bad Bunny Tití Me Preguntó"],
    });
    expect(playerUrl(spotify, 1)).toBe(
      "https://www.youtube.com/results?search_query=Bad%20Bunny%20Tit%C3%AD%20Me%20Pregunt%C3%B3%20audio&lumen=1",
    );
    expect(linkDetail(spotify)).toBe("Spotify · playlist · 2 canciones");
  });

  it("YouTube suena tal cual; una playlist sola arranca con «Reproducir todo»", () => {
    expect(playerUrl(link({}), 0)).toBe("https://www.youtube.com/watch?v=kJQP7kiw5Fk");
    const playlist = link({
      kind: "playlist",
      url: "https://www.youtube.com/playlist?list=PLx123456",
    });
    expect(playerUrl(playlist, 0)).toBe("https://www.youtube.com/playlist?list=PLx123456&lumen=1");
    expect(linkDetail(playlist)).toBe("YouTube · playlist");
  });
});
