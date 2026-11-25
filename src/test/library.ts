import { readFileSync } from "node:fs";
import { vi } from "vitest";

/** Sirve public/ como lo haría la app. */
export function serveLibrary(): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const text = readFileSync(`public${url}`, "utf8");
    return { ok: true, text: async () => text, json: async () => JSON.parse(text) as unknown };
  });
}
