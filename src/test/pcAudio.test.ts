import { describe, it, expect } from "vitest";
import { BRAVE_ONLY, PC_AUDIO, appLabel, appOf, appSource, isPcSource } from "@/lib/pcAudio";

describe("Sonido de la PC o de un solo programa", () => {
  it("distingue todo, un programa y un micrófono", () => {
    expect(isPcSource(PC_AUDIO)).toBe(true);
    expect(isPcSource(BRAVE_ONLY)).toBe(true);
    expect(isPcSource("")).toBe(false);
    expect(isPcSource("a1b2c3-micrófono")).toBe(false);
    expect(appOf(appSource("Spotify.exe"))).toBe("spotify.exe");
    expect(appOf(PC_AUDIO)).toBeNull();
  });

  it.each([
    ["brave.exe", "Brave"],
    ["spotify.exe", "Spotify"],
    ["valorant-win64-shipping.exe", "Valorant"],
    ["fortniteclient-win64-shipping.exe", "Fortniteclient"],
    ["discord.exe", "Discord"],
  ])("%s se llama %s", (exe, name) => {
    expect(appLabel(exe)).toBe(name);
  });
});
