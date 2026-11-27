import { describe, it, expect } from "vitest";
import { browserUrl, linkDetail, parseLink, type MusicLink } from "@/lib/links";

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

  it("Spotify se abre con sus videos de YouTube: uno solo, o la lista que arma YouTube", () => {
    const one = link({
      source: "spotify",
      kind: "track",
      tracks: ["Carly Rae Jepsen Cut To The Feeling"],
      videos: ["Qlsu7RhOnsQ"],
    });
    expect(browserUrl(one)).toBe("https://www.youtube.com/watch?v=Qlsu7RhOnsQ");
    const many = link({
      source: "spotify",
      kind: "playlist",
      tracks: ["a", "b", "c"],
      videos: ["Qlsu7RhOnsQ", null, "kJQP7kiw5Fk"],
    });
    expect(browserUrl(many)).toBe("https://www.youtube.com/watch_videos?video_ids=Qlsu7RhOnsQ,kJQP7kiw5Fk");
    expect(linkDetail(many)).toBe("Spotify · playlist · 3 canciones");
    expect(browserUrl(link({ source: "spotify", kind: "track", tracks: ["x"], videos: [null] }))).toBeNull();
  });

  it("YouTube se abre tal cual", () => {
    expect(browserUrl(link({}))).toBe("https://www.youtube.com/watch?v=kJQP7kiw5Fk");
    const playlist = link({ kind: "playlist", url: "https://www.youtube.com/playlist?list=PLx123456" });
    expect(browserUrl(playlist)).toBe("https://www.youtube.com/playlist?list=PLx123456");
    expect(linkDetail(playlist)).toBe("YouTube · playlist");
  });
});
