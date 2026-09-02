import type { FixtureDefinition, FixtureInstance } from "@/types/fixture";

/**
 * IMPORTANTE (ver AUDIT.md §7): no encontré la hoja de canales OFICIAL de
 * "Orus 280W 3in1" (marca no identificable en manuales públicos — es un
 * moving head 280W beam/spot/wash genérico, posiblemente reetiquetado) ni
 * el orden exacto de canales del Big Dipper LPC007 en modo 7CH (confirmé
 * por búsqueda web que soporta modos de 3 y 7 canales, RGB 3-en-1, pero no
 * el orden canal-por-canal). Estas son PLANTILLAS con el layout más común
 * para este tipo de equipo — no las trates como verificadas. Tu propio
 * próximo paso (ya en memoria) es confirmar direcciones de inicio contra
 * la consola física MAX 512; aprovecha ese mismo momento para corregir
 * estas plantillas canal por canal en el Fixture Editor.
 */

let uid = 0;
const id = (prefix: string) => `${prefix}-${++uid}`;

export const seedDefinitions: FixtureDefinition[] = [
  {
    id: "def-orus-280",
    manufacturer: "Orus",
    model: "280W 3in1 Moving Head",
    verified: false,
    verifiedNote:
      "Plantilla genérica de 16 canales para moving head beam/spot/wash 280W — verificar contra la hoja del fabricante o la consola MAX 512.",
    panLimit: { min: 0, max: 540 },
    tiltLimit: { min: 0, max: 270 },
    channels: [
      { id: id("ch"), index: 1, name: "Pan", type: "PAN", dmxMin: 0, dmxMax: 255, defaultValue: 128, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 2, name: "Pan Fine", type: "PAN_FINE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 3, name: "Tilt", type: "TILT", dmxMin: 0, dmxMax: 255, defaultValue: 90, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 4, name: "Tilt Fine", type: "TILT_FINE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 5, name: "Speed Pan/Tilt", type: "SPEED", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 6, name: "Dimmer", type: "DIMMER", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 7, name: "Strobe", type: "STROBE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [{ id: id("pr"), label: "Abierto", dmxFrom: 0, dmxTo: 7 }] },
      { id: id("ch"), index: 8, name: "Color Wheel", type: "COLOR_WHEEL", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 9, name: "Gobo", type: "GOBO", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 10, name: "Gobo Rot", type: "GOBO_ROT", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 11, name: "Prism", type: "PRISM", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 12, name: "Prism Rot", type: "PRISM_ROT", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 13, name: "Frost", type: "FROST", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 14, name: "Focus", type: "FOCUS", dmxMin: 0, dmxMax: 255, defaultValue: 128, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 15, name: "Zoom", type: "ZOOM", dmxMin: 0, dmxMax: 255, defaultValue: 128, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 16, name: "Funciones especiales", type: "MACRO", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [], notes: "Reset, control de lámpara, macros de fábrica según manual." },
    ],
  },
  {
    id: "def-lpc007",
    manufacturer: "Big Dipper",
    model: "LPC007 (PAR LED RGB 3in1)",
    verified: false,
    verifiedNote:
      "Confirmado por búsqueda web: soporta modo 3CH y 7CH, 54×3W RGB 3-en-1. El orden exacto de canales del modo 7CH no está confirmado — plantilla estándar Master Dimmer/RGB/Strobe/Mode/Speed.",
    channels: [
      { id: id("ch"), index: 1, name: "Master Dimmer", type: "DIMMER", dmxMin: 0, dmxMax: 255, defaultValue: 255, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 2, name: "Red", type: "RED", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 3, name: "Green", type: "GREEN", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 4, name: "Blue", type: "BLUE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 5, name: "Strobe", type: "STROBE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [{ id: id("pr"), label: "Abierto", dmxFrom: 0, dmxTo: 7 }] },
      { id: id("ch"), index: 6, name: "Mode", type: "MODE", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
      { id: id("ch"), index: 7, name: "Speed", type: "SPEED", dmxMin: 0, dmxMax: 255, defaultValue: 0, invert: false, curve: "linear", presets: [] },
    ],
  },
];

/**
 * Instancias semilla — reflejan tu rig real (memoria del proyecto):
 * 2x Orus 280W 3in1, 4x Big Dipper LPC007. Direcciones secuenciales
 * desde 1 como PUNTO DE PARTIDA, no confirmadas — ese es tu próximo
 * paso pendiente contra la consola MAX 512.
 */
export const seedInstances: FixtureInstance[] = [
  { id: id("inst"), definitionId: "def-orus-280", label: "BEAM 280 ORUS #1", universe: 1, address: 1 },
  { id: id("inst"), definitionId: "def-orus-280", label: "BEAM 280 ORUS #2", universe: 1, address: 17 },
  { id: id("inst"), definitionId: "def-lpc007", label: "LPC007 PAR #1", universe: 1, address: 33 },
  { id: id("inst"), definitionId: "def-lpc007", label: "LPC007 PAR #2", universe: 1, address: 40 },
  { id: id("inst"), definitionId: "def-lpc007", label: "LPC007 PAR #3", universe: 1, address: 47 },
  { id: id("inst"), definitionId: "def-lpc007", label: "LPC007 PAR #4", universe: 1, address: 54 },
];
