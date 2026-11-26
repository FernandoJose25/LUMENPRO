//! Lo que está pasando ahora: valores en vivo, momento, chase y effects. No
//! tiene reloj ni hilos: quien lo usa llama a `tick` con la hora en
//! milisegundos (la misma base que `Date.now()`).

use crate::frame::{self, Frame, Overlay};
use crate::model::{Action, Channel, ChannelType, ChannelValues, Definition, Doc, Effect, EffectKind, EffectSource, Pad};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const IDENTIFY_MS: f64 = 3000.0;
/// Lo que tarda una figura en abrirse al arrancar y en volver al centro al
/// detenerse: sin esto la cabeza pegaría un salto.
const FIGURE_RAMP_MS: f64 = 1000.0;
const MAX_STEP_MS: f64 = 50.0;
/// Sin noticias del audio en este tiempo, sus niveles ya no valen.
const LEVELS_STALE_MS: f64 = 500.0;
/// El ritmo sí se puede seguir contando un rato aunque la ventana se trabe.
const BEATS_STALE_MS: f64 = 10_000.0;

#[derive(Debug, Clone, Deserialize)]
pub struct AudioFeed {
    pub levels: Levels,
    pub beat: Option<Beat>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Levels {
    pub bass: f64,
    pub mid: f64,
    pub treble: f64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Beat {
    /// Golpes contados, con decimales.
    pub beats: f64,
    pub bpm: f64,
}

/// Órdenes de la interfaz.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Message {
    /// Otro show (al abrir o importar): nada queda corriendo.
    Reset { doc: Value, #[serde(default)] live: Value, #[serde(default)] active_scene_id: Option<String>, #[serde(default)] active_moment_id: Option<String> },
    /// El mismo show, editado: lo que corre sigue.
    Doc { doc: Value },
    Values { #[serde(deserialize_with = "crate::model::values")] values: ChannelValues },
    ActiveScene { id: Option<String> },
    RecallScene { id: String },
    StartEffect { id: String },
    StopEffect { id: String },
    Blackout { on: bool },
    Master { value: f64 },
    Strobe { on: bool },
    Identify { id: String },
    StartMoment { id: String },
    StepMoment { direction: i32 },
    StopMoment,
    PlayChase { id: String },
    StopChase,
    Audio { audio: Option<AudioFeed> },
    /// Un botón (press: true al apretar, false al soltar) o un fader (value 0–1).
    Action { action: Action, #[serde(default)] press: Option<bool>, #[serde(default)] value: Option<f64> },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MomentRun {
    pub nonce: u64,
    pub started_at: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Fade,
    Hold,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChaseStatus {
    pub id: String,
    pub step_index: usize,
    pub phase: Phase,
    /// 0–1 dentro de la fase actual, en centésimas.
    pub progress: f64,
}

/// Lo que la interfaz y el celular muestran, además de los valores en vivo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Playback {
    pub active_scene_id: Option<String>,
    pub running_effect_ids: Vec<String>,
    pub blackout_active: bool,
    /// Intensidad general, 0–100.
    pub master: f64,
    pub strobe_active: bool,
    pub identify_id: Option<String>,
    pub active_moment_id: Option<String>,
    /// `None` = detenido.
    pub moment_run: Option<MomentRun>,
    pub chase: Option<ChaseStatus>,
}

impl Default for Playback {
    fn default() -> Self {
        Self {
            active_scene_id: None,
            running_effect_ids: Vec::new(),
            blackout_active: false,
            master: 100.0,
            strobe_active: false,
            identify_id: None,
            active_moment_id: None,
            moment_run: None,
            chase: None,
        }
    }
}

/// Foto completa, para retomar si el motor se reinicia en pleno show.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub doc: Value,
    #[serde(deserialize_with = "crate::model::values")]
    pub live: ChannelValues,
    pub playback: Playback,
}

/// Un paso del fade. Pan y tilt con canal fino van juntos: por separado, el
/// fino iría y vendría y la cabeza temblaría.
#[derive(Debug, Clone)]
struct FadeItem {
    instance: String,
    channel: String,
    fine: Option<String>,
    from: f64,
    to: f64,
    snap: bool,
}

#[derive(Debug, Clone, Default)]
struct Fade(Vec<FadeItem>);

impl Fade {
    /// Desde lo que está saliendo ahora hasta `target`.
    fn new(doc: &Doc, live: &ChannelValues, target: &ChannelValues) -> Self {
        let mut items = Vec::new();
        for (instance, definition) in doc.rig() {
            let Some(to) = target.get(&instance.id) else { continue };
            let now = |channel: &crate::model::Channel| {
                let value = live.get(&instance.id).and_then(|c| c.get(&channel.id)).copied();
                f64::from(value.unwrap_or_else(|| channel.default_dmx()))
            };
            for (channel, role) in definition.channels.iter().zip(&definition.roles) {
                let Some(end) = to.get(&channel.id).map(|v| f64::from(*v)) else { continue };
                let fine = role.fine.map(|i| &definition.channels[i]);
                // Un fino va junto con su canal, si también está en la escena.
                let joined = role.is_fine
                    && definition.channels.iter().zip(&definition.roles).any(|(coarse, r)| {
                        r.fine.is_some_and(|i| definition.channels[i].id == channel.id) && to.contains_key(&coarse.id)
                    });
                if joined {
                    continue;
                }
                let mut item = FadeItem {
                    instance: instance.id.clone(),
                    channel: channel.id.clone(),
                    fine: None,
                    from: now(channel),
                    to: end,
                    snap: !channel.kind.is_fadeable(),
                };
                if let Some((fine, fine_end)) = fine.and_then(|f| Some((f, f64::from(*to.get(&f.id)?)))) {
                    item.fine = Some(fine.id.clone());
                    item.from = item.from * 256.0 + now(fine);
                    item.to = item.to * 256.0 + fine_end;
                }
                items.push(item);
            }
        }
        Self(items)
    }

    fn at(&self, t: f64) -> Vec<(&str, &str, u8)> {
        let mut out = Vec::with_capacity(self.0.len());
        for item in &self.0 {
            let value = if item.snap { item.to } else { (item.from + (item.to - item.from) * t).round() } as u32;
            match &item.fine {
                Some(fine) => {
                    out.push((item.instance.as_str(), item.channel.as_str(), (value >> 8) as u8));
                    out.push((item.instance.as_str(), fine.as_str(), (value & 255) as u8));
                }
                None => out.push((item.instance.as_str(), item.channel.as_str(), value as u8)),
            }
        }
        out
    }
}

#[derive(Debug, Clone)]
struct MomentFade {
    nonce: u64,
    fade: Fade,
    done: bool,
}

#[derive(Debug, Clone)]
struct ChaseRun {
    id: String,
    /// Lo arrancó un momento: si el momento cambia de chase, este se cambia.
    from_moment: bool,
    step: usize,
    phase: Phase,
    phase_at: f64,
    fade: Fade,
}

#[derive(Default)]
pub struct Show {
    doc_json: Value,
    doc: Doc,
    live: ChannelValues,
    playback: Playback,

    /// Sube con cada cambio; `changes` manda solo lo posterior a lo ya visto.
    rev: u64,
    live_rev: BTreeMap<String, BTreeMap<String, u64>>,
    playback_rev: u64,
    /// Antes de esta revisión los valores eran de otro show.
    reset_rev: u64,

    moment_fade: Option<MomentFade>,
    next_nonce: u64,
    chase: Option<ChaseRun>,
    effect_started: BTreeMap<String, f64>,
    /// Cuánto abrió cada figura, 0–1. Las que se detuvieron siguen acá hasta
    /// volver al centro.
    figures: BTreeMap<String, f64>,
    /// Dónde están las cabezas que dibujan una figura. No toca `live`: el
    /// centro es lo que diga `live`, y se puede mover mientras tanto.
    moving: ChannelValues,
    moving_rev: u64,
    last_tick: f64,
    identify_until: f64,
    audio: Option<(AudioFeed, f64)>,
}

/// Vueltas completas que lleva un effect.
fn cycles_of(effect: &Effect, started: f64, beats: Option<f64>, now: f64) -> f64 {
    match beats.filter(|_| effect.source == EffectSource::Beat) {
        Some(beats) => beats / effect.beats_per_cycle.max(0.01),
        None => (now - started) / 1000.0 * effect.speed_cpm / 60.0,
    }
}

/// Cuánto suena la parte de la música que sigue, si sigue alguna.
fn level_of(effect: &Effect, levels: Option<Levels>) -> Option<f64> {
    levels.and_then(|l| match effect.source {
        EffectSource::Bass => Some(l.bass),
        EffectSource::Mid => Some(l.mid),
        EffectSource::Treble => Some(l.treble),
        EffectSource::Clock | EffectSource::Beat => None,
    })
}

fn smooth(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

/// Los pares pan/tilt de un equipo, como índices de canal. Un pan compartido
/// por varias cabezas se mueve con la primera.
fn heads_of(definition: &Definition) -> Vec<[Option<usize>; 2]> {
    let cells = |kind| -> Vec<usize> {
        definition
            .cells(kind)
            .iter()
            .filter_map(|cell| cell.first())
            .filter_map(|channel| definition.channels.iter().position(|c| c.id == channel.id))
            .collect()
    };
    let (pan, tilt) = (cells(ChannelType::Pan), cells(ChannelType::Tilt));
    (0..pan.len().max(tilt.len())).map(|i| [pan.get(i).copied(), tilt.get(i).copied()]).collect()
}

impl Show {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn session(&self) -> Session {
        Session { doc: self.doc_json.clone(), live: self.live.clone(), playback: self.playback.clone() }
    }

    /// Sin show todavía (`reset` nunca llamado).
    pub fn is_empty(&self) -> bool {
        self.doc_json.is_null()
    }

    /// Hay algo moviéndose solo.
    pub fn is_playing(&self) -> bool {
        let p = &self.playback;
        p.moment_run.is_some() || p.chase.is_some() || !p.running_effect_ids.is_empty()
    }

    /// Retoma donde iba: los fades a medias se terminan desde donde quedaron.
    pub fn restore(&mut self, session: Session, now: f64) -> Result<(), String> {
        let doc = Doc::parse(&session.doc)?;
        self.reset(session.doc, doc, session.live);
        self.next_nonce = session.playback.moment_run.map_or(0, |r| r.nonce);
        let chase = session.playback.chase.clone();
        self.playback = Playback { identify_id: None, chase: None, ..session.playback };
        if let Some(chase) = chase {
            self.start_chase(&chase.id, self.active_moment_chase() == Some(chase.id.as_str()), now);
            self.begin_step(chase.step_index, now);
        }
        // El fade ya había arrancado los effects: con el momento dado por
        // llegado no se reinician.
        if let Some(run) = self.playback.moment_run {
            let done = now - run.started_at >= self.active_moment().map_or(0.0, |m| m.fade_ms);
            if done {
                self.moment_fade = Some(MomentFade { nonce: run.nonce, fade: Fade::default(), done: true });
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------------
    // Órdenes
    // ------------------------------------------------------------------

    pub fn apply(&mut self, message: Message, now: f64) -> Result<(), String> {
        match message {
            Message::Reset { doc, live, active_scene_id, active_moment_id } => {
                let parsed = Doc::parse(&doc)?;
                let live = crate::model::values(live).unwrap_or_default();
                self.reset(doc, parsed, live);
                self.playback = Playback { active_scene_id, active_moment_id, ..Playback::default() };
                self.prune();
            }
            Message::Doc { doc } => {
                self.doc = Doc::parse(&doc)?;
                self.doc_json = doc;
                self.prune();
                self.follow_moment_chase(now);
            }
            Message::Values { values } => {
                for (instance, channels) in values {
                    for (channel, value) in channels {
                        self.set_live(&instance, &channel, value);
                    }
                }
            }
            Message::ActiveScene { id } => self.edit(|p| p.active_scene_id = id),
            Message::RecallScene { id } => self.recall_scene(&id),
            Message::StartEffect { id } => {
                if self.doc.effects.iter().any(|e| e.id == id) && !self.playback.running_effect_ids.contains(&id) {
                    self.edit(|p| p.running_effect_ids.push(id));
                }
            }
            Message::StopEffect { id } => self.edit(|p| p.running_effect_ids.retain(|e| *e != id)),
            Message::Blackout { on } => self.edit(|p| p.blackout_active = on),
            Message::Master { value } => {
                let value = if value.is_finite() { value.round().clamp(0.0, 100.0) } else { return Ok(()) };
                self.edit(|p| p.master = value);
            }
            Message::Strobe { on } => self.edit(|p| p.strobe_active = on),
            Message::Identify { id } => {
                self.identify_until = now + IDENTIFY_MS;
                self.edit(|p| p.identify_id = Some(id));
            }
            Message::StartMoment { id } => self.start_moment(&id, now),
            Message::StepMoment { direction } => self.step_moment(direction, now),
            Message::StopMoment => self.stop_moment(),
            Message::PlayChase { id } => self.start_chase(&id, false, now),
            Message::StopChase => self.stop_chase(),
            Message::Audio { audio } => self.audio = audio.map(|feed| (feed, now)),
            Message::Action { action, press, value } => self.act(&action, press, value, now),
        }
        Ok(())
    }

    /// Orden del celular. Lo que no reconoce lo ignora.
    pub fn remote(&mut self, command: &Value, now: f64) {
        let on = command["on"].as_bool();
        match command["type"].as_str().unwrap_or("") {
            kind @ ("next" | "prev") => {
                // Doble toque, o dos celulares a la vez: el segundo ya no coincide.
                if command.get("from").is_some_and(|f| f.as_str() == self.playback.active_moment_id.as_deref()) {
                    self.step_moment(if kind == "next" { 1 } else { -1 }, now);
                }
            }
            "moment" => {
                if let Some(id) = command["id"].as_str() {
                    self.start_moment(id, now);
                }
            }
            "stop" => self.stop_moment(),
            "blackout" => {
                if let Some(on) = on {
                    self.edit(|p| p.blackout_active = on);
                }
            }
            "strobe" => {
                if let Some(on) = on {
                    self.edit(|p| p.strobe_active = on);
                }
            }
            "master" => {
                if let Some(value) = command["value"].as_f64() {
                    let _ = self.apply(Message::Master { value }, now);
                }
            }
            "pad" => {
                let pad = self.doc.phone_pads.iter().find(|p| Some(p.id.as_str()) == command["id"].as_str());
                if let Some(action) = pad.map(|p| p.action.clone()) {
                    self.act(&action, command["press"].as_bool(), command["value"].as_f64(), now);
                }
            }
            _ => {}
        }
    }

    /// Lo mismo venga de Live, del celular o de un controlador MIDI.
    pub fn act(&mut self, action: &Action, press: Option<bool>, value: Option<f64>, now: f64) {
        let pressed = press == Some(true);
        let value = value.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 1.0));
        let message = match action {
            Action::Strobe => press.map(|on| Message::Strobe { on }),
            Action::Master => value.map(|v| Message::Master { value: v * 100.0 }),
            Action::GroupFader { group_id, channel_type } => {
                let Some(v) = value else { return };
                let level = (v * 255.0).round() as u8;
                let writes: Vec<(String, String)> = self
                    .doc
                    .rig()
                    .filter(|(i, _)| i.group.as_ref() == Some(group_id))
                    .flat_map(|(i, d)| {
                        d.channels.iter().filter(|c| c.kind == *channel_type).map(move |c| (i.id.clone(), c.id.clone()))
                    })
                    .collect();
                for (instance, channel) in writes {
                    self.set_live(&instance, &channel, level);
                }
                return;
            }
            _ if !pressed => None,
            Action::Next => Some(Message::StepMoment { direction: 1 }),
            Action::Prev => Some(Message::StepMoment { direction: -1 }),
            Action::Stop => Some(Message::StopMoment),
            Action::Moment { id } => Some(Message::StartMoment { id: id.clone() }),
            Action::Scene { id } => Some(Message::RecallScene { id: id.clone() }),
            Action::Effect { id } if self.playback.running_effect_ids.contains(id) => {
                Some(Message::StopEffect { id: id.clone() })
            }
            Action::Effect { id } => Some(Message::StartEffect { id: id.clone() }),
            Action::Chase { id } if self.playback.chase.as_ref().is_some_and(|c| c.id == *id) => {
                Some(Message::StopChase)
            }
            Action::Chase { id } => Some(Message::PlayChase { id: id.clone() }),
            Action::Blackout => Some(Message::Blackout { on: !self.playback.blackout_active }),
            Action::Palette { id } => {
                let values = self.doc.palettes.iter().find(|p| p.id == *id).map(|p| p.values.clone());
                values.map(|values| Message::Values { values })
            }
            Action::Nothing => None,
        };
        if let Some(message) = message {
            let _ = self.apply(message, now);
        }
    }

    /// Si lo que hace el botón está encendido ahora: para pintarlo y para la
    /// luz del controlador.
    pub fn is_active(&self, action: &Action) -> bool {
        let p = &self.playback;
        match action {
            Action::Moment { id } => p.active_moment_id.as_ref() == Some(id) && p.moment_run.is_some(),
            Action::Scene { id } => p.active_scene_id.as_ref() == Some(id),
            Action::Effect { id } => p.running_effect_ids.contains(id),
            Action::Chase { id } => p.chase.as_ref().is_some_and(|c| c.id == *id),
            Action::Blackout => p.blackout_active,
            Action::Strobe => p.strobe_active,
            Action::Stop => p.moment_run.is_none(),
            _ => false,
        }
    }

    /// Valor de un fader, 0–1.
    pub fn fader_value(&self, action: &Action) -> Option<f64> {
        match action {
            Action::Master => Some(self.playback.master / 100.0),
            _ => None,
        }
    }

    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    fn pads_snapshot(&self, pads: &[Pad]) -> Value {
        json!(pads
            .iter()
            .map(|p| json!({
                "id": p.id,
                "label": p.label,
                "size": p.size,
                "fader": p.action.is_fader(),
                "hold": p.action == Action::Strobe,
                "active": self.is_active(&p.action),
                "value": self.fader_value(&p.action),
            }))
            .collect::<Vec<_>>())
    }

    /// Todo cambio de `playback` pasa por acá para que se note.
    fn edit(&mut self, f: impl FnOnce(&mut Playback)) {
        let before = self.playback.clone();
        f(&mut self.playback);
        if self.playback != before {
            self.rev += 1;
            self.playback_rev = self.rev;
        }
    }

    fn set_live(&mut self, instance: &str, channel: &str, value: u8) {
        if self.live.get(instance).and_then(|c| c.get(channel)) == Some(&value) {
            return;
        }
        self.rev += 1;
        self.live.entry(instance.into()).or_default().insert(channel.into(), value);
        self.live_rev.entry(instance.into()).or_default().insert(channel.into(), self.rev);
    }

    fn reset(&mut self, doc_json: Value, doc: Doc, live: ChannelValues) {
        let (rev, next_nonce) = (self.rev + 1, self.next_nonce);
        *self = Self { doc_json, doc, live, rev, playback_rev: rev, reset_rev: rev, next_nonce, ..Self::default() };
    }

    /// Suelta lo que apunte a algo borrado.
    fn prune(&mut self) {
        let (effects, scenes, moments, chases) = (&self.doc.effects, &self.doc.scenes, &self.doc.moments, &self.doc.chases);
        let p = &self.playback;
        let running: Vec<String> =
            p.running_effect_ids.iter().filter(|id| effects.iter().any(|e| e.id == **id)).cloned().collect();
        let scene = p.active_scene_id.clone().filter(|id| scenes.iter().any(|s| s.id == *id));
        let moment = p.active_moment_id.clone().filter(|id| moments.iter().any(|m| m.id == *id));
        let chase_gone = self.chase.as_ref().is_some_and(|run| !chases.iter().any(|c| c.id == run.id));
        let moment_gone = moment != p.active_moment_id;
        self.edit(|p| {
            p.running_effect_ids = running;
            p.active_scene_id = scene;
            p.active_moment_id = moment;
        });
        if chase_gone {
            self.stop_chase();
        }
        if moment_gone {
            self.stop_moment();
        }
    }

    /// Merge, no blackout: solo pisa lo que la escena capturó.
    fn recall_scene(&mut self, id: &str) {
        let Some(scene) = self.doc.scene(id) else { return };
        for (instance, channels) in scene.values.clone() {
            for (channel, value) in channels {
                self.set_live(&instance, &channel, value);
            }
        }
        // Pedir una escena quita el Blackout: si no, el botón parecería roto.
        self.edit(|p| {
            p.active_scene_id = Some(id.into());
            p.blackout_active = false;
        });
    }

    // ------------------------------------------------------------------
    // Momentos
    // ------------------------------------------------------------------

    fn active_moment(&self) -> Option<&crate::model::Moment> {
        let id = self.playback.active_moment_id.as_ref()?;
        self.doc.moments.iter().find(|m| m.id == *id)
    }

    fn active_moment_chase(&self) -> Option<&str> {
        self.active_moment()?.chase_id.as_deref()
    }

    fn start_moment(&mut self, id: &str, now: f64) {
        let Some(moment) = self.doc.moments.iter().find(|m| m.id == id) else { return };
        let scene_id = moment.scene_id.clone();
        self.stop_chase();
        self.next_nonce = (self.next_nonce + 1).max(now as u64);
        let nonce = self.next_nonce;
        self.edit(|p| {
            p.active_moment_id = Some(id.into());
            p.moment_run = Some(MomentRun { nonce, started_at: now });
            p.active_scene_id = scene_id.or(p.active_scene_id.take());
            p.running_effect_ids.clear();
            p.blackout_active = false;
            p.strobe_active = false;
        });
    }

    /// Sin ninguno lanzado, "siguiente" es el primero.
    fn step_moment(&mut self, direction: i32, now: f64) {
        let current = self.doc.moments.iter().position(|m| Some(&m.id) == self.playback.active_moment_id.as_ref());
        let index = current.map_or(-1, |i| i as i64) + i64::from(direction);
        let next = usize::try_from(index).ok().and_then(|i| self.doc.moments.get(i)).map(|m| m.id.clone());
        if let Some(id) = next {
            self.start_moment(&id, now);
        }
    }

    /// Las luces quedan como están.
    fn stop_moment(&mut self) {
        self.stop_chase();
        self.moment_fade = None;
        self.edit(|p| {
            p.moment_run = None;
            p.running_effect_ids.clear();
        });
    }

    /// El rig entero según la escena: lo que no define vuelve a su default,
    /// para que el estrobo de un momento no se cuele en el siguiente.
    fn full_target(&self, scene_id: &str) -> ChannelValues {
        let Some(scene) = self.doc.scene(scene_id) else { return ChannelValues::new() };
        self.doc
            .rig()
            .map(|(instance, definition)| {
                let saved = scene.values.get(&instance.id);
                let channels = definition
                    .channels
                    .iter()
                    .map(|c| (c.id.clone(), saved.and_then(|s| s.get(&c.id)).copied().unwrap_or_else(|| c.default_dmx())))
                    .collect();
                (instance.id.clone(), channels)
            })
            .collect()
    }

    fn tick_moment(&mut self, now: f64) {
        let Some(run) = self.playback.moment_run else { return };
        let Some(moment) = self.active_moment().cloned() else { return };
        let elapsed = now - run.started_at;

        let mut current = match self.moment_fade.take() {
            Some(fade) if fade.nonce == run.nonce => fade,
            _ => {
                let target = moment.scene_id.as_deref().map(|id| self.full_target(id)).unwrap_or_default();
                MomentFade { nonce: run.nonce, fade: Fade::new(&self.doc, &self.live, &target), done: false }
            }
        };
        if !current.done {
            let t = if moment.fade_ms > 0.0 { (elapsed / moment.fade_ms).clamp(0.0, 1.0) } else { 1.0 };
            for (instance, channel, value) in current.fade.at(t) {
                self.set_live(instance, channel, value);
            }
            // Effects y chase recién al llegar: antes pelearían con el fade por
            // los mismos canales y las luces parpadearían.
            if t >= 1.0 {
                current.done = true;
                for id in &moment.effect_ids {
                    let _ = self.apply(Message::StartEffect { id: id.clone() }, now);
                }
                if let Some(chase) = &moment.chase_id {
                    self.start_chase(chase, true, now);
                }
            }
        }
        self.moment_fade = Some(current);

        let index = self.doc.moments.iter().position(|m| m.id == moment.id).unwrap_or(0);
        let next = self.doc.moments.get(index + 1).map(|m| m.id.clone());
        if let (Some(next), Some(seconds)) = (next, moment.duration_sec) {
            if elapsed >= seconds * 1000.0 {
                self.start_moment(&next, now);
            }
        }
    }

    // ------------------------------------------------------------------
    // Chases
    // ------------------------------------------------------------------

    /// Uno a la vez: arrancar otro reemplaza al que esté sonando.
    fn start_chase(&mut self, id: &str, from_moment: bool, now: f64) {
        let Some(chase) = self.doc.chases.iter().find(|c| c.id == id) else { return };
        if chase.steps.is_empty() {
            return;
        }
        self.chase = Some(ChaseRun {
            id: id.into(),
            from_moment,
            step: 0,
            phase: Phase::Fade,
            phase_at: now,
            fade: Fade::default(),
        });
        self.begin_step(0, now);
    }

    fn stop_chase(&mut self) {
        self.chase = None;
        self.edit(|p| p.chase = None);
    }

    /// Cambiar el chase del momento que está sonando se nota al instante.
    fn follow_moment_chase(&mut self, now: f64) {
        if !self.moment_fade.as_ref().is_some_and(|f| f.done) || self.playback.moment_run.is_none() {
            return;
        }
        let wanted = self.active_moment_chase().map(str::to_owned);
        let playing = self.chase.as_ref().filter(|c| c.from_moment).map(|c| c.id.clone());
        if wanted == playing || (wanted.is_some() && self.chase.as_ref().is_some_and(|c| !c.from_moment)) {
            return;
        }
        self.stop_chase();
        if let Some(id) = wanted {
            self.start_chase(&id, true, now);
        }
    }

    /// El fade arranca desde lo que esté en vivo en ese momento, no desde el
    /// paso anterior "en teoría": si alguien movió algo a mano, no salta.
    fn begin_step(&mut self, index: usize, now: f64) {
        let Some(mut run) = self.chase.take() else { return };
        let step = self.doc.chases.iter().find(|c| c.id == run.id).and_then(|c| c.steps.get(index));
        let Some(step) = step else { return self.stop_chase() };
        let target = self.doc.scene(&step.scene_id).map(|s| s.values.clone()).unwrap_or_default();
        run.step = index;
        run.phase = Phase::Fade;
        run.phase_at = now;
        run.fade = Fade::new(&self.doc, &self.live, &target);
        self.publish_chase(&run, 0.0);
        self.chase = Some(run);
    }

    fn publish_chase(&mut self, run: &ChaseRun, progress: f64) {
        let status = ChaseStatus {
            id: run.id.clone(),
            step_index: run.step,
            phase: run.phase,
            progress: (progress * 100.0).round() / 100.0,
        };
        self.edit(|p| p.chase = Some(status));
    }

    fn tick_chase(&mut self, now: f64) {
        let Some(mut run) = self.chase.take() else { return };
        let Some(chase) = self.doc.chases.iter().find(|c| c.id == run.id) else { return self.stop_chase() };
        let (count, looped) = (chase.steps.len(), chase.looped);
        // Borraron el paso que sonaba: se sigue desde el principio.
        let Some(step) = chase.steps.get(run.step).cloned() else {
            self.chase = Some(run);
            return self.begin_step(0, now);
        };
        let elapsed = now - run.phase_at;

        if run.phase == Phase::Fade {
            let t = if step.fade_ms > 0.0 { (elapsed / step.fade_ms).clamp(0.0, 1.0) } else { 1.0 };
            for (instance, channel, value) in run.fade.at(t) {
                self.set_live(instance, channel, value);
            }
            self.publish_chase(&run, t);
            if t >= 1.0 {
                run.phase = Phase::Hold;
                run.phase_at = now;
            }
            self.chase = Some(run);
            return;
        }

        let t = if step.hold_ms > 0.0 { (elapsed / step.hold_ms).clamp(0.0, 1.0) } else { 1.0 };
        let next = run.step + 1;
        self.publish_chase(&run, t);
        self.chase = Some(run);
        if t >= 1.0 {
            if next < count {
                self.begin_step(next, now);
            } else if looped {
                self.begin_step(0, now);
            } else {
                self.stop_chase();
            }
        }
    }

    // ------------------------------------------------------------------
    // Effects
    // ------------------------------------------------------------------

    fn levels(&self, now: f64) -> Option<Levels> {
        let (feed, at) = self.audio.as_ref()?;
        (now - at <= LEVELS_STALE_MS).then_some(feed.levels)
    }

    fn beats(&self, now: f64) -> Option<f64> {
        let (feed, at) = self.audio.as_ref()?;
        let beat = feed.beat?;
        (now - at <= BEATS_STALE_MS).then(|| beat.beats + (now - at) * beat.bpm / 60_000.0)
    }

    fn tick_effects(&mut self, now: f64) {
        let running = &self.playback.running_effect_ids;
        // Al volver a arrancar, la fase empieza de cero.
        self.effect_started.retain(|id, _| running.contains(id) || self.figures.contains_key(id));
        if running.is_empty() {
            return;
        }
        let (levels, beats) = (self.levels(now), self.beats(now));
        let mut writes = Vec::new();
        for id in running {
            let Some(effect) = self.doc.effects.iter().find(|e| e.id == *id) else { continue };
            let started = *self.effect_started.entry(id.clone()).or_insert(now);
            if effect.kind != EffectKind::Wave {
                continue;
            }
            let Some(group) = &effect.group_id else { continue };
            let cycles = cycles_of(effect, started, beats, now);
            let level = level_of(effect, levels);
            // Una barra de varios focos cuenta como varias luces seguidas.
            let cells = self
                .doc
                .rig()
                .filter(|(i, _)| i.group.as_ref() == Some(group))
                .flat_map(|(member, definition)| {
                    definition.cells(effect.channel_type).into_iter().map(move |cell| (member, cell))
                });
            for (index, (member, channels)) in cells.enumerate() {
                let phase = cycles + index as f64 * effect.phase_offset_deg / 360.0;
                let t = level.unwrap_or_else(|| effect.waveform.level(phase));
                let value = (effect.min + (effect.max - effect.min) * t).round().clamp(0.0, 255.0) as u8;
                for channel in channels {
                    writes.push((member.id.clone(), channel.id.clone(), value));
                }
            }
        }
        for (instance, channel, value) in writes {
            self.set_live(&instance, &channel, value);
        }
    }

    /// Abre las figuras que corren y cierra las que se detuvieron.
    fn ramp_figures(&mut self, now: f64) {
        // Tras un reinicio o una suspensión, un paso normal: abrir de golpe
        // sería el salto que esto evita.
        let elapsed = (now - self.last_tick).clamp(0.0, MAX_STEP_MS);
        let step = elapsed / FIGURE_RAMP_MS;
        let is_running = |id: &String| self.playback.running_effect_ids.contains(id);
        for effect in self.doc.effects.iter().filter(|e| e.kind == EffectKind::Figure) {
            if is_running(&effect.id) {
                let open = self.figures.entry(effect.id.clone()).or_insert(0.0);
                *open = (*open + step).min(1.0);
            }
        }
        let effects = &self.doc.effects;
        self.figures.retain(|id, open| {
            if !is_running(id) {
                *open -= step;
            }
            *open > 0.0 && effects.iter().any(|e| e.id == *id && e.kind == EffectKind::Figure)
        });
        for id in self.figures.keys() {
            self.effect_started.entry(id.clone()).or_insert(now);
        }
    }

    fn tick_figures(&mut self, now: f64) {
        self.ramp_figures(now);
        let (levels, beats) = (self.levels(now), self.beats(now));
        // (instancia, índice del canal) -> grados de más
        let mut offsets: BTreeMap<(&str, usize), f64> = BTreeMap::new();
        for (id, open) in &self.figures {
            let Some(effect) = self.doc.effects.iter().find(|e| e.id == *id) else { continue };
            let Some(group) = &effect.group_id else { continue };
            let started = self.effect_started.get(id).copied().unwrap_or(now);
            let cycles = cycles_of(effect, started, beats, now);
            // Siguiendo la música, la figura crece con lo que suena.
            let size = effect.size_deg * smooth(*open) * level_of(effect, levels).unwrap_or(1.0);
            let (sin, cos) = effect.angle_deg.to_radians().sin_cos();

            let heads: Vec<_> = self
                .doc
                .rig()
                .filter(|(i, _)| i.group.as_ref() == Some(group))
                .flat_map(|(i, d)| heads_of(d).into_iter().map(move |axes| (i, d, axes)))
                .collect();
            let count = heads.len();
            for (index, (instance, definition, axes)) in heads.into_iter().enumerate() {
                let place = if count > 1 { 2.0 * index as f64 / (count - 1) as f64 - 1.0 } else { 0.0 };
                let phase = cycles + index as f64 * effect.phase_offset_deg / 360.0;
                let (x, y) = effect.figure.at(phase, place);
                let turned = [x * cos - y * sin, x * sin + y * cos];
                for (axis, offset) in axes.into_iter().zip(turned) {
                    let Some(channel) = axis else { continue };
                    let range = definition.range(definition.channels[channel].kind);
                    *offsets.entry((&instance.id, channel)).or_default() += offset * size / range;
                }
            }
        }

        let mut moving = ChannelValues::new();
        for ((instance, channel), offset) in offsets {
            let Some((_, definition)) = self.doc.rig().find(|(i, _)| i.id == instance) else { continue };
            let coarse = &definition.channels[channel];
            let fine = definition.roles[channel].fine.map(|i| &definition.channels[i]);
            let read = |c: &Channel| {
                let value = self.live.get(instance).and_then(|v| v.get(&c.id)).copied();
                f64::from(value.unwrap_or_else(|| c.default_dmx()))
            };
            let center = read(coarse) * 256.0 + fine.map_or(0.0, read);
            let position = (center + offset * 65536.0).round().clamp(0.0, 65535.0) as u32;
            let channels = moving.entry(instance.to_string()).or_default();
            match fine {
                Some(fine) => {
                    channels.insert(coarse.id.clone(), (position >> 8) as u8);
                    channels.insert(fine.id.clone(), (position & 255) as u8);
                }
                None => {
                    channels.insert(coarse.id.clone(), ((position + 128) >> 8).min(255) as u8);
                }
            }
        }
        if moving != self.moving {
            self.rev += 1;
            self.moving_rev = self.rev;
            self.moving = moving;
        }
    }

    // ------------------------------------------------------------------
    // Salida
    // ------------------------------------------------------------------

    pub fn tick(&mut self, now: f64) {
        self.tick_moment(now);
        self.tick_chase(now);
        self.tick_effects(now);
        self.tick_figures(now);
        self.last_tick = now;
        if self.playback.identify_id.is_some() && now >= self.identify_until {
            self.edit(|p| p.identify_id = None);
        }
    }

    pub fn frame(&self, universe: i32) -> Frame {
        let p = &self.playback;
        let overlay = Overlay {
            blackout: p.blackout_active,
            master: p.master,
            strobe: p.strobe_active,
            identify: p.identify_id.as_deref(),
        };
        frame::build(&self.doc, &self.live, &self.moving, &overlay, universe)
    }

    pub fn rev(&self) -> u64 {
        self.rev
    }

    /// Lo que cambió después de la revisión `since` (0 = todo).
    pub fn changes(&self, since: u64) -> Value {
        // Más adelante que yo: es de un motor anterior.
        let full = since < self.reset_rev || since > self.rev;
        let mut out = json!({ "rev": self.rev, "full": full });
        if full {
            out["values"] = json!(self.live);
        } else {
            let mut values = BTreeMap::new();
            for (instance, channels) in &self.live_rev {
                let changed: BTreeMap<_, _> = channels
                    .iter()
                    .filter(|(_, rev)| **rev > since)
                    .map(|(channel, _)| (channel, self.live[instance][channel]))
                    .collect();
                if !changed.is_empty() {
                    values.insert(instance, changed);
                }
            }
            out["values"] = json!(values);
        }
        if full || self.moving_rev > since {
            out["moving"] = json!(self.moving);
        }
        if full || self.playback_rev > since {
            out["playback"] = json!(self.playback);
        }
        out
    }

    /// Lo que muestra el celular (src-tauri/src/remote.html).
    pub fn phone_snapshot(&self, dmx: &str) -> Value {
        let p = &self.playback;
        let moments: Vec<_> = self
            .doc
            .moments
            .iter()
            .map(|m| json!({ "id": m.id, "name": m.name, "durationSec": m.duration_sec }))
            .collect();
        json!({
            "moments": moments,
            "activeId": p.active_moment_id,
            "startedAt": p.moment_run.map(|r| r.started_at),
            "blackout": p.blackout_active,
            "strobe": p.strobe_active,
            "master": p.master,
            "dmx": dmx,
            "pads": self.pads_snapshot(&self.doc.phone_pads),
        })
    }
}
