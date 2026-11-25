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
    Gobo,
    GoboRot,
    Prism,
    PrismRot,
    Frost,
    Zoom,
    Focus,
    Strobe,
    Speed,
    Mode,
    Macro,
    #[default]
    #[serde(other)]
    Other,
}

impl ChannelType {
    pub fn is_color(self) -> bool {
        use ChannelType::*;
        matches!(self, Red | Green | Blue | White)
    }

    /// Canales que emiten luz. MODE entra porque un PAR en programa automático
    /// puede ignorar el dimmer. Pan/Tilt, gobos, color, foco y MACRO (reset,
    /// lámpara) quedan fuera a propósito: llevarlos a 0 movería las cabezas.
    pub fn is_light(self) -> bool {
        self == ChannelType::Dimmer || self == ChannelType::Mode || self.is_color()
    }

    /// Solo lo que es cantidad de luz: en pan/tilt o en un canal por rangos una
    /// curva cambiaría a dónde apunta o qué hace.
    pub fn accepts_curve(self) -> bool {
        self == ChannelType::Dimmer || self.is_color()
    }

    /// Los canales por rangos (estrobo, gobo, rueda de color, macros…) saltan:
    /// interpolarlos haría pasar la luz por todo lo que hay en medio.
    pub fn is_fadeable(self) -> bool {
        use ChannelType::*;
        self.is_color() || matches!(self, Dimmer | Pan | PanFine | Tilt | TiltFine | Zoom | Focus | Frost)
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
}

impl Definition {
    pub fn has(&self, f: impl Fn(ChannelType) -> bool) -> bool {
        self.channels.iter().any(|c| f(c.kind))
    }

    pub fn first(&self, kind: ChannelType) -> Option<&Channel> {
        self.channels.iter().find(|c| c.kind == kind)
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Scene {
    pub id: String,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Effect {
    pub id: String,
    pub group_id: Option<String>,
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Doc {
    pub definitions: Vec<Definition>,
    pub instances: Vec<Instance>,
    pub scenes: Vec<Scene>,
    pub chases: Vec<Chase>,
    pub effects: Vec<Effect>,
    pub moments: Vec<Moment>,
}

impl Doc {
    pub fn definition(&self, id: &str) -> Option<&Definition> {
        self.definitions.iter().find(|d| d.id == id)
    }

    pub fn scene(&self, id: &str) -> Option<&Scene> {
        self.scenes.iter().find(|s| s.id == id)
    }

    /// Instancias con su perfil; las que apuntan a uno borrado se saltan.
    pub fn rig(&self) -> impl Iterator<Item = (&Instance, &Definition)> {
        self.instances.iter().filter_map(|i| Some((i, self.definition(&i.definition_id)?)))
    }
}
