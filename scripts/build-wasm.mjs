// Compila el motor del show (show-engine/) a WASM para el navegador y los
// tests. La app de escritorio no lo usa: ahí corre en su propio proceso.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const target = "wasm32-unknown-unknown";
execFileSync("cargo", ["build", "--release", "--quiet", "--target", target], {
  cwd: "show-engine",
  stdio: "inherit",
});
mkdirSync("src/engine", { recursive: true });
copyFileSync(`show-engine/target/${target}/release/lumenpro_show.wasm`, "src/engine/show_engine.wasm");
