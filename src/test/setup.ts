import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadWasm } from "@/lib/wasmEngine";
import { resetDialogs } from "./dialogs";

// El motor de verdad (npm run wasm), no una imitación.
loadWasm(readFileSync("src/engine/show_engine.wasm"));

afterEach(() => {
  cleanup();
  resetDialogs();
});
