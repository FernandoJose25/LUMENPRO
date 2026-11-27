//! El show tal como lo programa la interfaz (`src/types/*.ts`). Se lee con
//! tolerancia: un campo que falta o un número vacío no debe dejar sin luces.

use serde::{Deserialize, Deserializer};
use std::collections::BTreeMap;

/// instanceId -> channelId -> valor DMX, la misma forma que `Scene.values`.
pub type ChannelValues = BTreeMap<String, BTreeMap<String, u8>>;

fn num<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(serde_json::Value::deserialize(d)?.as_f64().unwrap_or(0.0))
}

fn int<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    Ok(num(d)?.round() as i32)
}

fn dmx(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

pub fn values<'de, D: Deserializer<'de>>(d: D) -> Result<ChannelValues, D::Error> {
    let raw = BTreeMap::<String, BTreeMap<String, serde_json::Value>>::deserialize(d)?;
    Ok(raw
        .into_iter()
        .map(|(instance, channels)| {
            let channels = channels.into_iter().filter_map(|(id, v)| Some((id, dmx(v.as_f64()?)))).collect();
            (instance, channels)
        })
        .collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ChannelType {
    Pan,
    PanFine,
    Tilt,
    TiltFine,
    Dimmer,
    Color,
    ColorWheel,
    Red,
    Green,
    Blue,
    White,
    Amber,
    Uv,
    Lime,
    Indigo,
    Cyan,
    Magenta,
    Yellow,
    Hue,
    Saturation,
    Cto,
    Gobo,
    GoboRot,
    Prism,
    PrismRot,
    Frost,
    Zoom,
    Focus,
    Iris,
    Strobe,
    Speed,
    Mode,
    Macro,
    /// Segunda mitad de un canal de 16 bits (`Channel::fine_of`).
    Fine,
    #[default]
    #[serde(other)]
    Other,
}

impl ChannelType {
    /// Canal de un LED: más valor, más luz. Cian, magenta y amarillo pueden ser
    /// LED o filtros: depende del equipo (`Definition::emits`).
    fn is_emitter(self) -> bool {
        use ChannelType::*;
        matches!(self, Red | Green | Blue | White | Amber | Uv | Lime | Indigo)
    }

    fn is_cmy(self) -> bool {
        use ChannelType::*;
        matches!(self, Cyan | Magenta | Yellow)
    }

    /// Solo lo que es cantidad de luz: en pan/tilt o en un canal por rangos una
    /// curva cambiaría a dónde apunta o qué hace.
    pub fn accepts_curve(self) -> bool {
        self == ChannelType::Dimmer || self.is_emitter() || self.is_cmy()
    }

    /// Lo que decide el color: lo que tapa el color fijo.
    pub fn is_color(self) -> bool {
        use ChannelType::*;
        self.is_emitter() || self.is_cmy() || matches!(self, Hue | Saturation | Cto | Color | ColorWheel)
    }

    /// Los canales por rangos (estrobo, gobo, rueda de color, macros…) saltan:
    /// interpolarlos haría pasar la luz por todo lo que hay en medio.
    pub fn is_fadeable(self) -> bool {
        use ChannelType::*;
        self.is_emitter()
            || self.is_cmy()
            || matches!(
                self,
                Dimmer | Pan | PanFine | Tilt | TiltFine | Zoom | Focus | Frost | Iris | Cto | Saturation | Fine
            )
    }

    /// El canal fino que lo completa a 16 bits.
    pub fn fine(self) -> Option<ChannelType> {
        match self {
            ChannelType::Pan => Some(ChannelType::PanFine),
            ChannelType::Tilt => Some(ChannelType::TiltFine),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
pub enum Curve {
    #[serde(rename = "log")]
    Log,
    #[serde(rename = "s-curve")]
    S,
    #[default]
    #[serde(other)]
    Linear,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preset {
    pub label: String,
    /// Qué hace ("open", "strobe"…), si se sabe.
    pub kind: Option<String>,
    #[serde(deserialize_with = "num")]
    pub dmx_from: f64,
    #[serde(deserialize_with = "num")]
    pub dmx_to: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Channel {
    pub id: String,
    #[serde(deserialize_with = "int")]
    pub index: i32,
    #[serde(rename = "type")]
    pub kind: ChannelType,
    #[serde(deserialize_with = "num")]
    pub dmx_min: f64,
    #[serde(deserialize_with = "num")]
    pub dmx_max: f64,
    #[serde(deserialize_with = "num")]
    pub default_value: f64,
    pub invert: bool,
    pub curve: Curve,
    pub presets: Vec<Preset>,
    /// En un canal fino, el id del que completa.
    pub fine_of: Option<String>,
    /// Dimmer general de un equipo que además tiene dimmers por foco.
    pub master: bool,
}

impl Channel {
    pub fn default_dmx(&self) -> u8 {
        dmx(self.default_value)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Definition {
    pub id: String,
    pub channels: Vec<Channel>,
    /// Tipo de equipo según QLC+ ("Moving Head", "Smoke"…), si se sabe.
    pub kind: Option<String>,
    /// Barras y equipos de varios focos: los ids de canal de cada uno.
    pub heads: Vec<Vec<String>>,
    pub pan_limit: Option<Limit>,
    pub tilt_limit: Option<Limit>,
    /// Lo que se deduce del perfil, por canal (`prepare`). Una barra puede
    /// tener 480 canales y esto se consulta 50 veces por segundo.
    #[serde(skip)]
    pub roles: Vec<Role>,
}

/// Recorrido en grados.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(default)]
pub struct Limit {
    #[serde(deserialize_with = "num")]
    pub max: f64,
}

// Recorrido habitual de una cabeza móvil, si el perfil no dice otra cosa.
const PAN_RANGE: f64 = 540.0;
const TILT_RANGE: f64 = 270.0;

#[derive(Debug, Clone, Default)]
pub struct Role {
    /// Índice del canal fino que lo completa.
    pub fine: Option<usize>,
    /// Es el fino de otro.
    pub is_fine: bool,
    pub follows_master: bool,
    pub goes_dark: bool,
    /// Foco al que pertenece.
    head: Option<usize>,
}

impl Definition {
    pub fn has(&self, f: impl Fn(ChannelType) -> bool) -> bool {
        self.channels.iter().any(|c| f(c.kind))
    }

    /// Con los tres y sin rojo son filtros: más valor, menos luz.
    fn is_subtractive(&self) -> bool {
        use ChannelType::*;
        [Cyan, Magenta, Yellow].iter().all(|kind| self.has(|k| k == *kind)) && !self.has(|k| k == Red)
    }

    /// El canal es de un LED de color.
    pub fn emits(&self, kind: ChannelType) -> bool {
        kind.is_emitter() || (kind.is_cmy() && !self.is_subtractive())
    }

    fn prepare(&mut self) {
        let mut roles: Vec<Role> = self
            .channels
            .iter()
            .map(|c| Role {
                fine: self.fine_for(c),
                is_fine: false,
                follows_master: self.follows_master(c),
                goes_dark: self.goes_dark(c),
                head: self.heads.iter().position(|head| head.contains(&c.id)),
            })
            .collect();
        for fine in roles.iter().filter_map(|r| r.fine).collect::<Vec<_>>() {
            roles[fine].is_fine = true;
        }
        self.roles = roles;
    }

    fn goes_dark(&self, channel: &Channel) -> bool {
        // Sin dimmer ni color, cerrar el shutter es la única forma de apagarlo.
        self.is_light(channel.kind) || (channel.kind == ChannelType::Strobe && !self.has(|k| self.is_light(k)))
    }

    /// Canales que emiten luz, los que el Blackout lleva a 0. MODE y COLOR
    /// entran porque un PAR en programa automático puede ignorar el dimmer.
    /// Pan/Tilt, gobos, rueda de color, foco y MACRO (reset, lámpara) quedan
    /// fuera a propósito: llevarlos a 0 movería las cabezas.
    fn is_light(&self, kind: ChannelType) -> bool {
        use ChannelType::*;
        matches!(kind, Dimmer | Mode | Color) || self.emits(kind)
    }

    /// Humo y ventiladores no son luces: ni la intensidad general ni
    /// "Identificar" los tocan. (El Blackout sí los apaga.)
    pub fn gives_light(&self) -> bool {
        !matches!(self.kind.as_deref(), Some("Smoke" | "Hazer" | "Fan"))
    }

    fn in_a_head(&self, channel: &Channel) -> bool {
        self.heads.iter().any(|head| head.contains(&channel.id))
    }

    /// La intensidad general baja el dimmer; sin dimmer, los colores. Con un
    /// dimmer general y otro por foco, solo el general: si no, bajaría dos
    /// veces.
    fn follows_master(&self, channel: &Channel) -> bool {
        if !self.gives_light() {
            return false;
        }
        let mut dimmers = self.channels.iter().filter(|c| c.kind == ChannelType::Dimmer).peekable();
        if dimmers.peek().is_none() {
            return self.emits(channel.kind);
        }
        if channel.kind != ChannelType::Dimmer {
            return false;
        }
        let dimmers: Vec<_> = dimmers.collect();
        if dimmers.iter().any(|c| c.master) {
            return channel.master;
        }
        !self.in_a_head(channel) || dimmers.iter().all(|c| self.in_a_head(c))
    }

    /// El canal fino que completa a `channel`.
    fn fine_for(&self, channel: &Channel) -> Option<usize> {
        self.channels.iter().position(|c| c.fine_of.as_ref() == Some(&channel.id)).or_else(|| {
            let kind = channel.kind.fine()?;
            let first = self.channels.iter().find(|c| c.kind == channel.kind)?;
            self.channels.iter().position(|c| c.kind == kind && c.fine_of.is_none() && first.id == channel.id)
        })
    }

    /// Grados que recorre un eje de punta a punta.
    pub fn range(&self, axis: ChannelType) -> f64 {
        let (limit, usual) = match axis {
            ChannelType::Pan => (self.pan_limit, PAN_RANGE),
            _ => (self.tilt_limit, TILT_RANGE),
        };
        limit.map(|l| l.max).filter(|max| *max > 0.0).unwrap_or(usual)
    }

    pub fn fine_of(&self, channel: &Channel) -> Option<&Channel> {
        let index = self.channels.iter().position(|c| c.id == channel.id)?;
        Some(&self.channels[self.roles.get(index)?.fine?])
    }

    /// Grupos de canales de un tipo que se mueven por separado: uno por foco,
    /// o todos juntos si el equipo no los distingue.
    pub fn cells(&self, kind: ChannelType) -> Vec<Vec<&Channel>> {
        let of_kind: Vec<(&Channel, Option<usize>)> = self
            .channels
            .iter()
            .zip(&self.roles)
            .filter(|(c, _)| c.kind == kind)
            .map(|(c, role)| (c, role.head))
            .collect();
        let mut heads: BTreeMap<usize, Vec<&Channel>> = BTreeMap::new();
        for (channel, head) in &of_kind {
            if let Some(head) = head {
                heads.entry(*head).or_default().push(channel);
            }
        }
        if heads.is_empty() {
            vec![of_kind.into_iter().map(|(c, _)| c).collect()]
        } else {
            heads.into_values().collect()
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Instance {
    pub id: String,
    pub definition_id: String,
    #[serde(deserialize_with = "int")]
    pub universe: i32,
    #[serde(deserialize_with = "int")]
    pub address: i32,
    pub group: Option<String>,
    pub pan_invert: bool,
    pub tilt_invert: bool,
}

impl Instance {
    /// Mismo modelo en la misma dirección: el cable les manda lo mismo, así
    /// que van juntas (dos PAR en el 001).
    pub fn twin_of(&self, other: &Instance) -> bool {
        self.universe == other.universe && self.address == other.address && self.definition_id == other.definition_id
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scene {
    pub id: String,
    /// Ya con las paletas aplicadas (`Doc::parse`).
    #[serde(deserialize_with = "values")]
    pub values: ChannelValues,
    /// Paletas que usa: instanceId -> clase -> id. Mandan sobre `values`.
    refs: BTreeMap<String, BTreeMap<String, String>>,
}

/// Una posición, un color o un gobo con nombre, para varias luces.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Palette {
    pub id: String,
    #[serde(deserialize_with = "values")]
    pub values: ChannelValues,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
}

/// Un color de un toque, con lo que pone en cada luz que puede ponerlo. Los
/// valores los calcula la interfaz (`quickColors` en src/lib/palettes.ts).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuickColor {
    /// "#ff0000": también es su nombre para las órdenes.
    pub hex: String,
    pub name: String,
    #[serde(deserialize_with = "values")]
    pub values: ChannelValues,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChaseStep {
    pub scene_id: String,
    #[serde(deserialize_with = "num")]
    pub fade_ms: f64,
    #[serde(deserialize_with = "num")]
    pub hold_ms: f64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Chase {
    pub id: String,
    pub steps: Vec<ChaseStep>,
    #[serde(rename = "loop")]
    pub looped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Waveform {
    Square,
    Sawtooth,
    Triangle,
    Pulse,
    #[default]
    #[serde(other)]
    Sine,
}

impl Waveform {
    /// 0–1. `phase` acumula ciclos: solo importa la parte decimal.
    pub fn level(self, phase: f64) -> f64 {
        let p = phase - phase.floor();
        match self {
            Waveform::Square => f64::from(p < 0.5),
            Waveform::Sawtooth => p,
            Waveform::Triangle => 2.0 * p.min(1.0 - p),
            Waveform::Pulse => (1.0 - p) * (1.0 - p),
            Waveform::Sine => 0.5 + 0.5 * (std::f64::consts::TAU * p).sin(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectSource {
    Beat,
    Bass,
    Mid,
    Treble,
    #[default]
    #[serde(other)]
    Clock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectKind {
    /// Las cabezas dibujan una figura alrededor de donde estén.
    Figure,
    /// Cada punto de una barra o tira de LEDs con su color.
    Pixels,
    /// Un canal sube y baja.
    #[default]
    #[serde(other)]
    Wave,
}

/// Lo que dibujan los puntos de una barra o tira de LEDs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelPattern {
    /// Un punto de color que corre, con estela.
    Chase,
    /// Puntos que destellan al azar.
    Sparkle,
    /// Se llena desde abajo con lo que suena (verde, amarillo, rojo).
    Meter,
    /// Se llena y se vacía con el color.
    Fill,
    /// Los colores del arcoíris corren por la barra.
    #[default]
    #[serde(other)]
    Rainbow,
}

impl PixelPattern {
    /// Rojo, verde y azul (0–1) del punto `i` de `n`. `cycles`: vueltas que
    /// lleva; `level`: lo que suena (0–1), si sigue la música.
    pub fn color(self, i: usize, n: usize, cycles: f64, level: Option<f64>, color: [f64; 3]) -> [f64; 3] {
        let n = n.max(1);
        let place = i as f64 / n as f64;
        let frac = |x: f64| x - x.floor();
        let scaled = |b: f64| color.map(|c| c * b);
        match self {
            PixelPattern::Rainbow => hsv(frac(place + cycles)),
            PixelPattern::Chase => {
                let head = frac(cycles) * n as f64;
                let behind = (head - i as f64).rem_euclid(n as f64);
                let tail = (n as f64 * 0.3).max(1.0);
                scaled(if behind < tail { 1.0 - behind / tail } else { 0.0 })
            }
            PixelPattern::Sparkle => {
                let steps = cycles * 4.0;
                let lit = hash(i as u64, steps.floor() as i64) < 0.25;
                scaled(if lit { 1.0 - frac(steps) } else { 0.0 })
            }
            PixelPattern::Meter | PixelPattern::Fill => {
                let full = level.unwrap_or_else(|| Waveform::Triangle.level(cycles)) * n as f64;
                let b = (full - i as f64).clamp(0.0, 1.0);
                if self == PixelPattern::Meter {
                    // Verde abajo, rojo arriba.
                    hsv(0.33 * (1.0 - place)).map(|c| c * b)
                } else {
                    scaled(b)
                }
            }
        }
    }
}

/// Tono 0–1 a rojo, verde y azul a pleno.
fn hsv(h: f64) -> [f64; 3] {
    let h = (h - h.floor()) * 6.0;
    let x = 1.0 - (h % 2.0 - 1.0).abs();
    match h as u32 {
        0 => [1.0, x, 0.0],
        1 => [x, 1.0, 0.0],
        2 => [0.0, 1.0, x],
        3 => [0.0, x, 1.0],
        4 => [x, 0.0, 1.0],
        _ => [1.0, 0.0, x],
    }
}

/// Al azar pero siempre igual para el mismo punto y paso: 0–1.
fn hash(i: u64, step: i64) -> f64 {
    let mut x = i.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (step as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    x ^= x >> 31;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 29;
    (x >> 11) as f64 / (1u64 << 53) as f64
}

/// "#ff8800" → rojo, verde y azul 0–1; blanco si no se entiende.
pub fn rgb_of(hex: Option<&str>) -> [f64; 3] {
    let parse = |hex: &str| -> Option<[f64; 3]> {
        let hex = hex.strip_prefix('#')?;
        if hex.len() != 6 {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok().map(|b| f64::from(b) / 255.0);
        Some([byte(0)?, byte(2)?, byte(4)?])
    };
    hex.and_then(parse).unwrap_or([1.0; 3])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Figure {
    Eight,
    Line,
    Fan,
    #[default]
    #[serde(other)]
    Circle,
}

impl Figure {
    /// Desplazamiento de pan y tilt, de -1 a 1. `place` es el lugar de la
    /// cabeza en el grupo, de -1 (la primera) a 1 (la última).
    pub fn at(self, phase: f64, place: f64) -> (f64, f64) {
        let a = std::f64::consts::TAU * (phase - phase.floor());
        match self {
            Figure::Circle => (a.sin(), a.cos()),
            Figure::Eight => (a.sin(), (2.0 * a).sin() / 2.0),
            Figure::Line => (a.sin(), 0.0),
            // Se abre y se cierra.
            Figure::Fan => (place * (0.5 - 0.5 * a.cos()), 0.0),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Effect {
    pub id: String,
    pub name: String,
    pub group_id: Option<String>,
    pub kind: EffectKind,
    pub figure: Figure,
    /// Figuras: cuánto se aparta del centro, en grados.
    #[serde(deserialize_with = "num")]
    pub size_deg: f64,
    /// Figuras: giro del dibujo.
    #[serde(deserialize_with = "num")]
    pub angle_deg: f64,
    pub channel_type: ChannelType,
    pub waveform: Waveform,
    #[serde(deserialize_with = "num")]
    pub speed_cpm: f64,
    #[serde(deserialize_with = "num")]
    pub min: f64,
    #[serde(deserialize_with = "num")]
    pub max: f64,
    #[serde(deserialize_with = "num")]
    pub phase_offset_deg: f64,
    pub source: EffectSource,
    #[serde(deserialize_with = "num")]
    pub beats_per_cycle: f64,
    /// Píxeles: qué dibujan y de qué color (los que no son arcoíris).
    pub pattern: PixelPattern,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Moment {
    pub id: String,
    pub name: String,
    pub scene_id: Option<String>,
    pub chase_id: Option<String>,
    pub effect_ids: Vec<String>,
    #[serde(deserialize_with = "num")]
    pub fade_ms: f64,
    pub duration_sec: Option<f64>,
}

/// Lo que hace un botón de Live, del celular o de un controlador MIDI.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(tag = "do", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Action {
    Next,
    Prev,
    Stop,
    Moment { id: String },
    Scene { id: String },
    /// Arranca o detiene.
    Effect { id: String },
    Chase { id: String },
    /// En todas las luces que tiene.
    Palette { id: String },
    Blackout,
    /// Mientras se aprieta.
    Strobe,
    /// Fader: intensidad general.
    Master,
    /// Fader: un tipo de canal de un grupo.
    GroupFader { group_id: String, channel_type: ChannelType },
    /// Color fijo encima de lo que haga el momento. Sin grupo, todas las
    /// luces ("" son las que no tienen grupo); sin color, se suelta.
    Color { group_id: Option<String>, color: Option<String> },
    /// Arranca la línea de tiempo desde el principio, o la detiene.
    Timeline { id: String },
    /// Un toque al ritmo de la canción.
    Tap,
    /// Fader: velocidad de los effects y chases.
    Speed,
    /// Un efecto especial: dispara mientras se aprieta (o prende y apaga).
    Special { id: String },
    /// Arma o desarma un efecto especial que lo pide.
    Arm { id: String },
    #[default]
    #[serde(other)]
    Nothing,
}

impl Action {
    pub fn is_fader(&self) -> bool {
        matches!(self, Action::Master | Action::GroupFader { .. } | Action::Speed)
    }
}

/// Una marca de la línea de tiempo: a los `at_ms` de la canción hace
/// `action`. Con `length_ms`, al terminar deshace lo que hizo: el estrobo y el
/// apagón se quitan, el effect o el chase se detienen, el color se suelta.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cue {
    pub id: String,
    #[serde(deserialize_with = "num")]
    pub at_ms: f64,
    pub length_ms: Option<f64>,
    pub action: Action,
}

impl Cue {
    pub fn end_ms(&self) -> Option<f64> {
        self.length_ms.filter(|l| l.is_finite() && *l > 0.0).map(|l| self.at_ms + l)
    }
}

/// Lo que pasa en cada segundo de una canción (el vals). La canción la
/// reproduce la ventana; el motor lleva la cuenta y dispara las marcas.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Timeline {
    pub id: String,
    pub name: String,
    /// Lo que dura la canción.
    #[serde(deserialize_with = "num")]
    pub duration_ms: f64,
    pub cues: Vec<Cue>,
}

impl Timeline {
    /// Termina con la canción, o con la última marca si va más allá.
    pub fn end_ms(&self) -> f64 {
        self.cues.iter().map(|c| c.end_ms().unwrap_or(c.at_ms)).fold(self.duration_ms.max(0.0), f64::max)
    }
}

/// Humo, chispas frías, CO2, confeti: un canal que sale en 0 salvo mientras
/// se dispara. Ni las escenas ni los effects lo tocan.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Special {
    pub id: String,
    pub name: String,
    pub instance_id: String,
    pub channel_id: String,
    /// Valor DMX al disparar.
    #[serde(deserialize_with = "num")]
    pub level: f64,
    /// Lo más que dura un disparo, aunque se siga apretando.
    #[serde(deserialize_with = "num")]
    pub max_ms: f64,
    /// Chispas, CO2, confeti: hay que armarlo antes de disparar.
    pub needs_arm: bool,
    /// Un toque lo prende y otro lo apaga (el haze, toda la noche).
    pub latch: bool,
}

impl Special {
    pub fn dmx(&self) -> u8 {
        self.level.round().clamp(0.0, 255.0) as u8
    }
}

/// Un botón de las pantallas a medida.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Pad {
    pub id: String,
    pub label: String,
    pub action: Action,
    /// 1 normal, 2 grande.
    #[serde(deserialize_with = "int")]
    pub size: i32,
    /// Página donde va ("" = la primera).
    pub page: String,
    /// Color del botón ("#rrggbb"), si se eligió uno.
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlKind {
    Cc,
    #[default]
    #[serde(other)]
    Note,
}

/// Un botón o fader de un controlador MIDI, y lo que hace.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Control {
    pub id: String,
    /// Nombre del controlador; vacío = cualquiera.
    pub device: String,
    pub kind: ControlKind,
    /// 0–15.
    #[serde(deserialize_with = "int")]
    pub channel: i32,
    #[serde(deserialize_with = "int")]
    pub number: i32,
    pub action: Action,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Doc {
    pub definitions: Vec<Definition>,
    pub instances: Vec<Instance>,
    pub scenes: Vec<Scene>,
    pub palettes: Vec<Palette>,
    pub groups: Vec<Group>,
    /// Los colores fijos; no se guardan con el show.
    pub colors: Vec<QuickColor>,
    pub chases: Vec<Chase>,
    pub effects: Vec<Effect>,
    pub moments: Vec<Moment>,
    pub timelines: Vec<Timeline>,
    pub specials: Vec<Special>,
    pub live_pads: Vec<Pad>,
    pub phone_pads: Vec<Pad>,
    pub controls: Vec<Control>,
    /// Índice del perfil de cada instancia.
    #[serde(skip)]
    profile: Vec<Option<usize>>,
}

impl Doc {
    pub fn parse(json: &serde_json::Value) -> Result<Self, String> {
        let mut doc = Doc::deserialize(json).map_err(|e| format!("El show no se entiende: {e}"))?;
        doc.definitions.iter_mut().for_each(Definition::prepare);
        for scene in &mut doc.scenes {
            for (instance, classes) in &scene.refs {
                for id in classes.values() {
                    let palette = doc.palettes.iter().find(|p| p.id == *id);
                    if let Some(channels) = palette.and_then(|p| p.values.get(instance)) {
                        scene.values.entry(instance.clone()).or_default().extend(channels.clone());
                    }
                }
            }
        }
        doc.profile = doc
            .instances
            .iter()
            .map(|i| doc.definitions.iter().position(|d| d.id == i.definition_id))
            .collect();
        Ok(doc)
    }

    pub fn scene(&self, id: &str) -> Option<&Scene> {
        self.scenes.iter().find(|s| s.id == id)
    }

    /// Instancias con su perfil; las que apuntan a uno borrado se saltan.
    pub fn rig(&self) -> impl Iterator<Item = (&Instance, &Definition)> {
        self.instances.iter().zip(&self.profile).filter_map(|(i, p)| Some((i, &self.definitions[(*p)?])))
    }
}
