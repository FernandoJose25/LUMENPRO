// Genera public/library y public/gobos a partir de los perfiles de QLC+
// (Apache 2.0). Uso: node scripts/import-qlcplus.mjs <carpeta de qlcplus>
// Para comprobar el resultado contra los originales: scripts/verify-library.py
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const source = process.argv[2];
if (!source) throw new Error("Falta la carpeta de qlcplus");
const FIXTURES = path.join(source, "resources", "fixtures");
const GOBOS = path.join(source, "resources", "gobos");
const OUT = "public/library";
const OUT_GOBOS = "public/gobos";

// ---------------------------------------------------------------------
// XML: lo justo para los .qxf
// ---------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text) =>
  text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e) => {
    if (e[0] !== "#") return ENTITIES[e] ?? all;
    return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });

function parseXml(xml) {
  const root = { tag: "", attrs: {}, children: [], text: "" };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|[^<]+/g;
  for (const [all, closing, tag, attrs, selfClosing] of xml.matchAll(token)) {
    const top = stack[stack.length - 1];
    if (tag === undefined) {
      if (!all.startsWith("<")) top.text += decode(all);
    } else if (closing) {
      if (top.tag !== tag) throw new Error(`se esperaba </${top.tag}> y vino </${tag}>`);
      stack.pop();
    } else {
      const node = { tag, attrs: {}, children: [], text: "" };
      for (const [, name, a, b] of attrs.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        node.attrs[name] = decode(a ?? b);
      }
      top.children.push(node);
      if (!selfClosing) stack.push(node);
    }
  }
  if (stack.length !== 1) throw new Error("XML sin cerrar");
  return root.children[0];
}

const all = (node, tag) => node.children.filter((c) => c.tag === tag);
const one = (node, tag) => node.children.find((c) => c.tag === tag);
/** Hay nombres partidos en dos líneas. */
const tidy = (text) => text.trim().replace(/\s+/g, " ");
const textOf = (node, tag) => tidy(one(node, tag)?.text ?? "");
const number = (text) => (Number.isFinite(Number(text)) ? Number(text) : 0);

// ---------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------

/** Preset de canal de QLC+ → tipo de LUMEN PRO. Los "...Fine" se resuelven
 *  con el nombre sin el sufijo. */
const PRESET_TYPES = {
  IntensityMasterDimmer: "DIMMER",
  IntensityDimmer: "DIMMER",
  IntensityRed: "RED",
  IntensityGreen: "GREEN",
  IntensityBlue: "BLUE",
  IntensityWhite: "WHITE",
  IntensityAmber: "AMBER",
  IntensityUV: "UV",
  IntensityLime: "LIME",
  IntensityIndigo: "INDIGO",
  IntensityCyan: "CYAN",
  IntensityMagenta: "MAGENTA",
  IntensityYellow: "YELLOW",
  IntensityHue: "HUE",
  IntensitySaturation: "SATURATION",
  IntensityLightness: "DIMMER",
  IntensityValue: "DIMMER",
  PositionPan: "PAN",
  PositionXAxis: "PAN",
  PositionTilt: "TILT",
  PositionYAxis: "TILT",
  SpeedPanSlowFast: "SPEED",
  SpeedPanFastSlow: "SPEED",
  SpeedTiltSlowFast: "SPEED",
  SpeedTiltFastSlow: "SPEED",
  SpeedPanTiltSlowFast: "SPEED",
  SpeedPanTiltFastSlow: "SPEED",
  ColorMacro: "COLOR",
  ColorWheel: "COLOR_WHEEL",
  ColorRGBMixer: "COLOR",
  ColorCTOMixer: "CTO",
  ColorCTCMixer: "CTO",
  ColorCTBMixer: "CTO",
  GoboWheel: "GOBO",
  GoboIndex: "GOBO_ROT",
  ShutterStrobeSlowFast: "STROBE",
  ShutterStrobeFastSlow: "STROBE",
  ShutterIrisMinToMax: "IRIS",
  ShutterIrisMaxToMin: "IRIS",
  ShutterIris: "IRIS",
  BeamFocusNearFar: "FOCUS",
  BeamFocusFarNear: "FOCUS",
  BeamFocus: "FOCUS",
  BeamZoomSmallBig: "ZOOM",
  BeamZoomBigSmall: "ZOOM",
  BeamZoom: "ZOOM",
  PrismRotationSlowFast: "PRISM_ROT",
  PrismRotationFastSlow: "PRISM_ROT",
  NoFunction: "OTHER",
};

const COLOUR_TYPES = {
  Red: "RED",
  Green: "GREEN",
  Blue: "BLUE",
  White: "WHITE",
  Amber: "AMBER",
  UV: "UV",
  Cyan: "CYAN",
  Magenta: "MAGENTA",
  Yellow: "YELLOW",
  Lime: "LIME",
  Indigo: "INDIGO",
};

const ROTATES = /rot|index|shake|spin|speed/i;

function groupType(group, colour, name, caps) {
  const has = (test) => caps.some((c) => test(c.attrs.Preset ?? ""));
  switch (group) {
    case "Intensity":
      return COLOUR_TYPES[colour] ?? "DIMMER";
    case "Colour":
      if (/cto|ctb|ctc|temperature/i.test(name) && !has((p) => p.startsWith("Color"))) return "CTO";
      return "COLOR"; // rueda o macros: se decide al final, según el equipo
    case "Gobo":
      if (has((p) => p === "GoboMacro" || p === "GoboShakeMacro" || p === "GenericPicture")) return "GOBO";
      return has((p) => p.startsWith("Rotation")) || ROTATES.test(name) ? "GOBO_ROT" : "GOBO";
    case "Shutter":
      return /iris/i.test(name) ? "IRIS" : "STROBE";
    case "Beam":
      if (/zoom/i.test(name)) return "ZOOM";
      if (/focus/i.test(name)) return "FOCUS";
      if (/frost|diffus/i.test(name)) return "FROST";
      if (/iris/i.test(name)) return "IRIS";
      return "OTHER";
    case "Prism":
      if (has((p) => p.startsWith("PrismEffect"))) return "PRISM";
      if (/frost/i.test(name)) return "FROST";
      return has((p) => p.startsWith("Rotation")) || ROTATES.test(name) ? "PRISM_ROT" : "PRISM";
    case "Speed":
      return "SPEED";
    case "Pan":
      return "PAN";
    case "Tilt":
      return "TILT";
    case "Effect":
      return "MODE";
    case "Maintenance":
      return "MACRO";
    default:
      return "OTHER";
  }
}

const hex = (text) => (/^#[0-9a-f]{6}$/i.test(text ?? "") ? text.toLowerCase() : null);
const usedGobos = new Set();

/** Qué hace un rango, en los términos que usan el simulador y el estrobo. */
function capabilityKind(preset) {
  if (preset === "ShutterOpen") return "open";
  if (preset === "ShutterClose") return "closed";
  if (preset.startsWith("Strobe")) return "strobe";
  if (preset.startsWith("Pulse") || preset.startsWith("Ramp")) return "pulse";
  if (preset === "GoboShakeMacro") return "shake";
  if (preset.startsWith("RotationClockwise")) return "cw";
  if (preset.startsWith("RotationCounter")) return "ccw";
  if (preset === "RotationStop") return "stop";
  if (preset === "PrismEffectOn") return "prism";
  if (preset === "PrismEffectOff") return "off";
  if (preset === "LampOn" || preset === "LampOff") return "lamp";
  if (preset.startsWith("Reset")) return "reset";
  return null;
}

function capability(node) {
  const { Min, Max, Preset = "", Res1, Res2 } = node.attrs;
  const out = [number(Min), number(Max), tidy(node.text)];
  const extra = {};
  const kind = capabilityKind(Preset);
  if (kind) extra.k = kind;
  if (Preset === "ColorMacro" || Preset === "ColorDoubleMacro") {
    const colors = [hex(Res1), Preset === "ColorDoubleMacro" ? hex(Res2) : null].filter(Boolean);
    if (colors.length) extra.c = colors;
  }
  if (["GoboMacro", "GoboShakeMacro", "GenericPicture"].includes(Preset) && /\.\w+$/.test(Res1 ?? "")) {
    extra.g = Res1;
    usedGobos.add(Res1);
  }
  if (Preset === "PrismEffectOn" && number(Res1) > 1) extra.f = number(Res1);
  if (Object.keys(extra).length) out.push(extra);
  return out;
}

const middle = ([from, to]) => Math.round((from + to) / 2);

/** Valor con el que el equipo queda "listo y quieto": sin esto, un shutter en 0
 *  sería cerrado y la luz no encendería nunca. */
function defaultValue(type, preset, node, caps) {
  // En pan y tilt no: hay perfiles que las dejan contra un tope.
  if (node.attrs.Default !== undefined && type !== "PAN" && type !== "TILT") return number(node.attrs.Default);
  const find = (test) => caps.find(([, , label, extra]) => test(label, extra ?? {}));
  switch (type) {
    case "PAN":
    case "TILT":
    case "FOCUS":
      return 128;
    case "SPEED":
      return /SlowFast$/.test(preset) && preset.startsWith("Speed") ? 255 : 0;
    case "IRIS":
      return preset === "ShutterIrisMinToMax" ? 255 : 0;
    case "STROBE": {
      const open =
        find((_, e) => e.k === "open") ?? find((label, e) => !e.k && /open|no strobe|no function|strobe off/i.test(label));
      return open ? (open[0] === 0 ? 0 : open[1] === 255 ? 255 : middle(open)) : 0;
    }
    case "COLOR_WHEEL":
    case "COLOR": {
      const open = find((label, e) => e.c?.length === 1 && e.c[0] === "#ffffff" && /open|white|no colou?r/i.test(label));
      return open ? open[0] : 0;
    }
    case "PRISM": {
      const off = find((_, e) => e.k === "off");
      return off ? off[0] : 0;
    }
    default:
      return 0;
  }
}

function channel(node, isLed) {
  const preset = node.attrs.Preset ?? "";
  const name = tidy(node.attrs.Name);
  const group = one(node, "Group");
  const caps = all(node, "Capability");
  const fine = preset.endsWith("Fine") || group?.attrs.Byte === "1";
  let type = preset
    ? PRESET_TYPES[preset.replace(/Fine$/, "")]
    : groupType(group?.text.trim() ?? "", textOf(node, "Colour"), name, caps);
  if (type === undefined) throw new Error(`preset desconocido: ${preset}`);
  if (type === "COLOR" && !isLed && !/mixer/i.test(preset)) type = "COLOR_WHEEL";

  const out = { n: name, t: type };
  if (fine) {
    out.t = type === "PAN" ? "PAN_FINE" : type === "TILT" ? "TILT_FINE" : "FINE";
    out.b = type;
  }
  if (preset === "IntensityMasterDimmer") out.m = 1;
  if (["BeamZoomBigSmall", "ShutterIrisMinToMax"].includes(preset)) out.r = 1;
  const presets = caps.map(capability);
  const value = fine ? 0 : defaultValue(type, preset, node, presets);
  if (value) out.d = value;
  // Un solo rango 0–255 sin nada especial no aporta: el fader ya lo dice.
  if (presets.length > 1 || (presets[0]?.length ?? 0) > 3) out.p = presets;
  return out;
}

// ---------------------------------------------------------------------
// Equipos
// ---------------------------------------------------------------------

function physical(node) {
  if (!node) return undefined;
  const at = (tag, name) => number(one(node, tag)?.attrs[name]);
  const out = {
    pan: at("Focus", "PanMax"),
    tilt: at("Focus", "TiltMax"),
    lens: [at("Lens", "DegreesMin"), at("Lens", "DegreesMax")],
    width: at("Dimensions", "Width"),
    grid: [at("Layout", "Width"), at("Layout", "Height")],
  };
  if (!out.pan) delete out.pan;
  if (!out.tilt) delete out.tilt;
  if (!out.lens[1]) delete out.lens;
  if (!out.width) delete out.width;
  if (out.grid[0] * out.grid[1] <= 1) delete out.grid;
  return Object.keys(out).length ? out : undefined;
}

function fixture(file) {
  const root = parseXml(readFileSync(file, "utf8").replace(/^﻿/, ""));
  if (root.tag !== "FixtureDefinition") throw new Error("no es un perfil");
  const nodes = all(root, "Channel");
  // Con mezcla RGB o de LED, un canal "Colour" son macros de color; sin ella,
  // en una cabeza o un scanner es la rueda.
  const type = textOf(root, "Type");
  const mixes = nodes.some((n) => n.attrs.Preset === "IntensityRed" || textOf(n, "Colour") === "Red");
  const isLed = mixes || !["Moving Head", "Scanner", "Effect"].includes(type);
  const channels = nodes.map((n) => channel(n, isLed));
  const indexOf = new Map();
  channels.forEach((c, i) => {
    if (!indexOf.has(c.n)) indexOf.set(c.n, i);
  });

  const phys = physical(one(root, "Physical"));
  const modes = all(root, "Mode").map((m) => {
    const list = [];
    for (const c of all(m, "Channel")) {
      const index = indexOf.get(tidy(c.text));
      if (index === undefined) throw new Error(`canal desconocido: ${c.text}`);
      list[number(c.attrs.Number)] = index;
    }
    if (list.length !== all(m, "Channel").length || list.includes(undefined)) throw new Error("canales salteados");
    const mode = { n: tidy(m.attrs.Name), c: list };
    const heads = all(m, "Head").map((h) => all(h, "Channel").map((c) => number(c.text)));
    if (heads.length) mode.h = heads;
    const own = physical(one(m, "Physical"));
    if (own) mode.phys = own;
    return mode;
  });
  const out = { model: textOf(root, "Model"), type, channels, modes };
  if (phys) out.phys = phys;
  return { manufacturer: textOf(root, "Manufacturer"), out };
}

const byMaker = new Map();
const files = readdirSync(FIXTURES, { recursive: true })
  .filter((f) => f.endsWith(".qxf"))
  .sort();
for (const f of files) {
  try {
    const { manufacturer, out } = fixture(path.join(FIXTURES, f));
    if (!byMaker.has(manufacturer)) byMaker.set(manufacturer, []);
    byMaker.get(manufacturer).push(out);
  } catch (e) {
    throw new Error(`${f}: ${e.message}`);
  }
}

rmSync(OUT, { recursive: true, force: true });
rmSync(OUT_GOBOS, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const slug = (s) =>
  s
    .normalize("NFD")
    .replace(/[^\w]+/g, "-")
    .toLowerCase();
const compare = (a, b) => a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
const makers = [...byMaker.keys()].sort(compare);
const usedFiles = new Set();
const index = makers.map((maker) => {
  const fixtures = byMaker.get(maker).sort((a, b) => compare(a.model, b.model));
  let file = `${slug(maker)}.json`;
  if (usedFiles.has(file)) file = `${slug(maker)}-2.json`;
  if (usedFiles.has(file)) throw new Error(`nombre de archivo repetido: ${file}`);
  usedFiles.add(file);
  writeFileSync(path.join(OUT, file), JSON.stringify(fixtures));
  return {
    maker,
    file,
    // [modelo, tipo, [[modo, canales], …]]
    models: fixtures.map((f) => [f.model, f.type, f.modes.map((m) => [m.n, m.c.length])]),
  };
});

let commit = "";
try {
  commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  // sin git, queda sin versión
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ source: "QLC+", commit, makers: index }));

for (const gobo of [...usedGobos].sort()) {
  mkdirSync(path.join(OUT_GOBOS, path.dirname(gobo)), { recursive: true });
  copyFileSync(path.join(GOBOS, gobo), path.join(OUT_GOBOS, gobo));
}
copyFileSync(path.join(source, "COPYING"), path.join(OUT, "LICENSE.txt"));
writeFileSync(
  path.join(OUT, "NOTICE.txt"),
  `Los perfiles de equipos (esta carpeta) y las imágenes de gobos (public/gobos)
provienen de Q Light Controller Plus (QLC+), https://www.qlcplus.org
Copyright (c) Heikki Junnila, Massimo Callegari y los colaboradores de QLC+.
Se distribuyen bajo la licencia Apache 2.0 (LICENSE.txt).

Cambios: los archivos .qxf se convirtieron a JSON con scripts/import-qlcplus.mjs
(tipos de canal y valores iniciales propios de LUMEN PRO). Las imágenes no se
modificaron. Versión de origen: ${commit || "desconocida"}.
`,
);

const modes = [...byMaker.values()].flat().reduce((n, f) => n + f.modes.length, 0);
console.log(`${files.length} perfiles, ${makers.length} marcas, ${modes} modos, ${usedGobos.size} gobos`);
