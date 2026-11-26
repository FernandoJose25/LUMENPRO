// Arma latest.json, lo que la app consulta para saber si hay una versión nueva
// (src-tauri/src/updates.rs). Corre en el release, después de `tauri build`
// con la llave de firma: necesita el instalador y su .sig.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const REPO = "FernandoJose25/LUMENPRO";
const DIR = "src-tauri/target/release/bundle/nsis";

const { version } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const exe = readdirSync(DIR).find((f) => f.endsWith(`_${version}_x64-setup.exe`));
if (!exe) throw new Error(`No está el instalador de la ${version} en ${DIR}`);
const signature = readFileSync(`${DIR}/${exe}.sig`, "utf8").trim();

// Las novedades de esta versión: lo que va antes de "Para instalar", sin el
// título ni los asteriscos de negrita. En el release de Windows llega con CRLF.
const notes = readFileSync("docs/NOVEDADES.md", "utf8")
  .split(/\r?\n/)
  .join("\n")
  .split(/^### /m)[0]
  .replace(/^## .*\n/, "")
  .replaceAll("**", "")
  .trim();

writeFileSync(
  `${DIR}/latest.json`,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature,
          // GitHub cambia los espacios del nombre por puntos.
          url: `https://github.com/${REPO}/releases/download/v${version}/${exe.replaceAll(" ", ".")}`,
        },
      },
    },
    null,
    2,
  ),
);
console.log(`latest.json: ${version} → ${exe}`);
