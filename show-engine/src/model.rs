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
    /// Lo que se deduce del perfil, por canal (`prepare`). Una barra puede
    /// tener 480 canales y esto se consulta 50 veces por segundo.
    #[serde(skip)]
    pub roles: Vec<Role>,
}

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
    /// Índice del perfil de cada instancia.
    #[serde(skip)]
    profile: Vec<Option<usize>>,
}

impl Doc {
    pub fn parse(json: &serde_json::Value) -> Result<Self, String> {
        let mut doc = Doc::deserialize(json).map_err(|e| format!("El show no se entiende: {e}"))?;
        doc.definitions.iter_mut().for_each(Definition::prepare);
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
