import type { ChannelPreset, ChannelType, FixtureChannel, FixtureDefinition, PresetKind } from "@/types/fixture";

/**
 * Biblioteca de equipos de QLC+ (public/library, generada con
 * scripts/import-qlcplus.mjs). El índice se carga una vez; los perfiles, por
 * marca y solo cuando se eligen.
 */
export interface LibraryEntry {
  maker: string;
  model: string;
  /** Tipo de equipo según QLC+. */
  kind: string;
  modes: { name: string; channels: number }[];
  file: string;
}

interface RawIndex {
  makers: { maker: string; file: string; models: [string, string, [string, number][]][] }[];
}

type RawCapability = [number, number, string, { k?: PresetKind; c?: string[]; g?: string; f?: number }?];

interface RawChannel {
  /** Nombre, tipo, tipo del canal que completa (los finos), valor inicial. */
  n: string;
  t: ChannelType;
  b?: ChannelType;
  d?: number;
  m?: 1;
  r?: 1;
  p?: RawCapability[];
}

interface RawPhysical {
  pan?: number;
  tilt?: number;
  lens?: [number, number];
  width?: number;
  grid?: [number, number];
}

interface RawFixture {
  model: string;
  type: string;
  channels: RawChannel[];
  modes: { n: string; c: number[]; h?: number[][]; phys?: RawPhysical }[];
  phys?: RawPhysical;
}

const url = (file: string) => `${import.meta.env.BASE_URL}library/${file}`;
export const goboUrl = (gobo: string) => `${import.meta.env.BASE_URL}gobos/${gobo}`;

async function fetchJson<T>(file: string): Promise<T> {
  const response = await fetch(url(file));
  if (!response.ok) throw new Error(`No se pudo leer la biblioteca (${file})`);
  return (await response.json()) as T;
}

let index: Promise<LibraryEntry[]> | null = null;

export function loadLibrary(): Promise<LibraryEntry[]> {
  index ??= fetchJson<RawIndex>("index.json").then(({ makers }) =>
    makers.flatMap(({ maker, file, models }) =>
      models.map(([model, kind, modes]) => ({
        maker,
        model,
        kind,
        file,
        modes: modes.map(([name, channels]) => ({ name, channels })),
      })),
    ),
  );
  index.catch(() => (index = null)); // que se pueda reintentar
  return index;
}

const makers = new Map<string, Promise<RawFixture[]>>();

function loadMaker(file: string): Promise<RawFixture[]> {
  let maker = makers.get(file);
  if (!maker) {
    maker = fetchJson<RawFixture[]>(file);
    makers.set(file, maker);
    maker.catch(() => makers.delete(file));
  }
  return maker;
}

/** "LPC 007", "lpc-007" y "LPC007" son lo mismo. */
const squash = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

export function searchLibrary(entries: LibraryEntry[], query: string): LibraryEntry[] {
  const words = query.split(/\s+/).map(squash).filter(Boolean);
  if (words.length === 0) return entries;
  const all = words.join("");
  const scored = entries.flatMap((entry) => {
    const [maker, model] = [squash(entry.maker), squash(entry.model)];
    const text = maker + model;
    if (!words.every((w) => text.includes(w))) return [];
    const score = model === all ? 0 : model.startsWith(all) ? 1 : text.startsWith(all) ? 2 : model.includes(all) ? 3 : 4;
    return [{ entry, score }];
  });
  return scored.sort((a, b) => a.score - b.score).map(({ entry }) => entry);
}

const channelId = (entry: LibraryEntry, name: string) => `qlc:${squash(entry.maker)}/${squash(entry.model)}:${name}`;

function toPreset(id: string, [dmxFrom, dmxTo, label, extra]: RawCapability): ChannelPreset {
  return {
    id,
    label,
    dmxFrom,
    dmxTo,
    ...(extra?.k ? { kind: extra.k } : {}),
    ...(extra?.c?.[0] ? { color: extra.c[0] } : {}),
    ...(extra?.c?.[1] ? { color2: extra.c[1] } : {}),
    ...(extra?.g ? { gobo: extra.g } : {}),
    ...(extra?.f ? { facets: extra.f } : {}),
  };
}

/** El canal que completa un fino: el anterior más cercano de su tipo que no
 *  tenga ya el suyo; si no hay, el siguiente. */
function coarseOf(channels: RawChannel[], at: number, taken: Set<number>): number | undefined {
  const base = channels[at].b;
  const fits = (i: number) => channels[i].t === base && !taken.has(i);
  for (let i = at - 1; i >= 0; i--) if (fits(i)) return i;
  for (let i = at + 1; i < channels.length; i++) if (fits(i)) return i;
  return undefined;
}

export async function loadDefinition(entry: LibraryEntry, modeName: string): Promise<FixtureDefinition> {
  const fixtures = await loadMaker(entry.file);
  const fixture = fixtures.find((f) => f.model === entry.model);
  const mode = fixture?.modes.find((m) => m.n === modeName);
  if (!fixture || !mode) throw new Error(`${entry.maker} ${entry.model} no tiene el modo ${modeName}`);

  const raw = mode.c.map((i) => fixture.channels[i]);
  // Los nombres se repiten en un puñado de perfiles: el id no puede.
  const seen = new Map<string, number>();
  const ids = raw.map((c) => {
    const n = (seen.get(c.n) ?? 0) + 1;
    seen.set(c.n, n);
    return channelId(entry, n === 1 ? c.n : `${c.n}#${n}`);
  });
  const taken = new Set<number>();
  const channels = raw.map((c, i): FixtureChannel => {
    const coarse = c.b ? coarseOf(raw, i, taken) : undefined;
    if (coarse !== undefined) taken.add(coarse);
    return {
      id: ids[i],
      index: i + 1,
      name: c.n,
      type: c.t,
      dmxMin: 0,
      dmxMax: 255,
      defaultValue: c.d ?? 0,
      invert: false,
      curve: "linear",
      presets: (c.p ?? []).map((p, n) => toPreset(`${ids[i]}:${n}`, p)),
      ...(coarse !== undefined ? { fineOf: ids[coarse] } : {}),
      ...(c.m ? { master: true } : {}),
      ...(c.r ? { reversed: true } : {}),
    };
  });

  const physical = { ...fixture.phys, ...mode.phys };
  return {
    id: `qlc:${squash(entry.maker)}/${squash(entry.model)}/${mode.n}`,
    manufacturer: entry.maker,
    model: fixture.model,
    mode: mode.n,
    kind: fixture.type,
    channels,
    ...(mode.h ? { heads: mode.h.map((head) => head.map((i) => ids[i]).filter(Boolean)) } : {}),
    ...(physical.pan ? { panLimit: { min: 0, max: physical.pan } } : {}),
    ...(physical.tilt ? { tiltLimit: { min: 0, max: physical.tilt } } : {}),
    ...(physical.lens ? { lens: { min: physical.lens[0], max: physical.lens[1] } } : {}),
    ...(physical.width ? { width: physical.width / 1000 } : {}),
    ...(physical.grid ? { grid: physical.grid } : {}),
    library: { maker: entry.maker, model: entry.model },
    verified: false,
    verifiedNote: "Perfil de la biblioteca de QLC+. Falta probarlo contra la luz.",
  };
}
