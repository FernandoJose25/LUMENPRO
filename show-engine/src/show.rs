//! Lo que está pasando ahora: valores en vivo, momento, chase y effects. No
//! tiene reloj ni hilos: quien lo usa llama a `tick` con la hora en
//! milisegundos (la misma base que `Date.now()`).

use crate::frame::{self, Frame, Overlay};
use crate::model::{
    Action, Channel, ChannelType, ChannelValues, Cue, Definition, Doc, Effect, EffectKind, EffectSource, Pad, Timeline,
};
use crate::tap::Tap;
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
/// La canción y el reloj del motor pueden separarse un poco: recién con esta
/// diferencia las luces se corren a donde va la canción.
const SYNC_TOLERANCE_MS: f64 = 40.0;
/// Un toque que dice haber sido hace más que esto llega tarde por otra cosa:
/// cuenta como recién tocado.
const TAP_LATE_MS: f64 = 1000.0;
/// Velocidad de los effects y chases, en %: de un cuarto a cuatro veces.
pub const SPEED_MIN: f64 = 25.0;
pub const SPEED_MAX: f64 = 400.0;
/// Armado, un efecto especial espera el disparo hasta cinco minutos.
const ARM_MS: f64 = 5.0 * 60_000.0;
/// Sin un máximo propio, un disparo dura esto.
const SPECIAL_DEFAULT_MS: f64 = 5000.0;
/// VirtualDJ manda un golpe por golpe: sin noticias en este tiempo, la
/// canción paró o se desconectó.
const DJ_STALE_MS: f64 = 3000.0;

/// El último golpe que mandó el programa del DJ (OS2L).
#[derive(Debug, Clone, Copy)]
struct DjBeat {
    beats: f64,
    bpm: f64,
    strength: f64,
    at: f64,
}

impl DjBeat {
    fn beats(&self, now: f64) -> f64 {
        self.beats + (now - self.at) * self.bpm / 60_000.0
    }
}

/// Fader de 0 a 1 → %, con 100 % en el medio.
fn speed_from_fader(v: f64) -> f64 {
    (SPEED_MIN * (SPEED_MAX / SPEED_MIN).powf(v)).round()
}

fn fader_from_speed(speed: f64) -> f64 {
    ((speed / SPEED_MIN).ln() / (SPEED_MAX / SPEED_MIN).ln()).clamp(0.0, 1.0)
}

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
    /// Desde ese punto de la canción (también para seguir tras una pausa).
    PlayTimeline { id: String, #[serde(default)] from_ms: f64 },
    PauseTimeline,
    StopTimeline,
    /// Por dónde va la canción que suena en la ventana.
    TimelineSync { id: String, position_ms: f64 },
    /// Un toque al ritmo. `at`: cuándo se tocó, si llegó con demora (el
    /// celular por WiFi); sin él, ahora.
    Tap { #[serde(default)] at: Option<f64> },
    /// Vuelve a seguir lo que se escucha.
    ClearTap,
    /// Velocidad de los effects y chases, en %.
    Speed { value: f64 },
    /// Dispara (o deja de disparar) un efecto especial.
    Fire { id: String, on: bool },
    /// Arma o desarma un efecto especial; sin `on`, lo cambia.
    Arm { id: String, #[serde(default)] on: Option<bool> },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MomentRun {
    pub nonce: u64,
    pub started_at: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineRun {
    pub id: String,
    /// Hora en que la canción estaba (o habría estado) en 0.
    pub started_at: f64,
    /// En pausa: dónde quedó la canción, en ms.
    pub paused_at: Option<f64>,
}

impl TimelineRun {
    pub fn position(&self, now: f64) -> f64 {
        self.paused_at.unwrap_or(now - self.started_at)
    }
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
    /// Color fijo de cada grupo ("" = las luces sin grupo): grupo -> "#ff0000".
    /// Los momentos no lo sueltan.
    pub held_colors: BTreeMap<String, String>,
    /// La línea de tiempo que suena.
    pub timeline: Option<TimelineRun>,
    /// El ritmo marcado a mano; mientras haya uno, manda sobre lo que se
    /// escucha.
    pub tap_bpm: Option<f64>,
    /// Velocidad de los effects y chases, en % (100 = la suya). Lo que sigue
    /// la música va con la música.
    pub speed: f64,
    /// Efectos especiales disparando: id -> hasta qué hora.
    pub firing: BTreeMap<String, f64>,
    /// Efectos especiales armados: id -> hasta qué hora.
    pub armed: BTreeMap<String, f64>,
    /// El tempo que manda el programa del DJ por OS2L, mientras llegan golpes.
    pub dj_bpm: Option<f64>,
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
            held_colors: BTreeMap::new(),
            timeline: None,
            tap_bpm: None,
            speed: 100.0,
            firing: BTreeMap::new(),
            armed: BTreeMap::new(),
            dj_bpm: None,
        }
    }
}

/// Lo que dispara una marca: al llegar, o al terminar si tiene duración.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Edge {
    /// Primero lo que termina: un estrobo que sigue a otro queda prendido.
    End,
    /// Después los momentos, que sueltan colores y effects…
    Moment,
    /// …y al final lo demás, que va encima del momento.
    Start,
}

/// Las marcas en el orden en que suenan.
fn edges(timeline: &Timeline) -> Vec<(f64, Edge, &Cue)> {
    let mut edges: Vec<(f64, Edge, &Cue)> = Vec::new();
    for cue in &timeline.cues {
        let start = if matches!(cue.action, Action::Moment { .. }) { Edge::Moment } else { Edge::Start };
        edges.push((cue.at_ms, start, cue));
        if let Some(end) = cue.end_ms() {
            edges.push((end, Edge::End, cue));
        }
    }
    edges.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    edges
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
    /// Hasta dónde de la canción ya se dispararon las marcas.
    timeline_cursor: f64,
    tap: Tap,
    /// El reloj de los effects y chases: corre a la velocidad elegida. Con
    /// 100 % es la hora misma.
    fx_clock: f64,
    clock_at: f64,
    dj: Option<DjBeat>,
}

/// Un punto de una barra: su lugar en el grupo, su luz y sus canales (0 rojo,
/// 1 verde, 2 azul, 3 brillo de un punto sin color).
type Pixel<'a> = (usize, &'a crate::model::Instance, Vec<(usize, &'a Channel)>);

/// Vueltas completas que lleva un effect.
fn cycles_of(effect: &Effect, started: f64, beats: Option<f64>, now: f64) -> f64 {
    match beats.filter(|_| effect.source == EffectSource::Beat) {
        Some(beats) => beats / effect.beats_per_cycle.max(0.01),
        None => (now - started) / 1000.0 * effect.speed_cpm / 60.0,
    }
}

/// Cuánto suena la parte de la música que sigue, si sigue alguna. Sin
/// música (o sin escuchar) es silencio: los PAR que laten con los graves se
/// quedan en su mínimo.
fn level_of(effect: &Effect, levels: Option<Levels>) -> Option<f64> {
    let l = levels.unwrap_or_default();
    match effect.source {
        EffectSource::Bass => Some(l.bass),
        EffectSource::Mid => Some(l.mid),
        EffectSource::Treble => Some(l.treble),
        EffectSource::Clock | EffectSource::Beat => None,
    }
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
        p.moment_run.is_some() || p.chase.is_some() || !p.running_effect_ids.is_empty() || p.timeline.is_some()
    }

    /// Retoma donde iba: los fades a medias se terminan desde donde quedaron.
    pub fn restore(&mut self, session: Session, now: f64) -> Result<(), String> {
        let doc = Doc::parse(&session.doc)?;
        self.reset(session.doc, doc, session.live);
        self.advance(now);
        self.next_nonce = session.playback.moment_run.map_or(0, |r| r.nonce);
        let chase = session.playback.chase.clone();
        self.playback = Playback { identify_id: None, chase: None, ..session.playback };
        // Lo que ya sonó no se repite.
        self.timeline_cursor = self.playback.timeline.as_ref().map_or(0.0, |run| run.position(now));
        // El golpe se pierde; el tempo no.
        self.tap = self.playback.tap_bpm.map(|bpm| Tap::resume(bpm, now)).unwrap_or_default();
        if let Some(chase) = chase {
            self.start_chase(&chase.id, self.active_moment_chase() == Some(chase.id.as_str()));
            self.begin_step(chase.step_index);
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
        self.advance(now);
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
                self.follow_moment_chase();
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
                // Lo último que se toca manda: un effect de color prendido a
                // mano se ve aunque su grupo tuviera un color fijo.
                let colors = self
                    .doc
                    .effects
                    .iter()
                    .find(|e| e.id == id)
                    .filter(|e| (e.kind == EffectKind::Wave && e.channel_type.is_color()) || e.kind == EffectKind::Pixels);
                if let Some(group) = colors.and_then(|e| e.group_id.clone()) {
                    self.edit(|p| {
                        p.held_colors.remove(&group);
                    });
                }
                self.start_effect(id);
            }
            Message::StopEffect { id } => self.edit(|p| p.running_effect_ids.retain(|e| *e != id)),
            Message::Blackout { on } => self.edit(|p| {
                p.blackout_active = on;
                // Blackout es también el botón de emergencia.
                if on {
                    p.firing.clear();
                }
            }),
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
            Message::PlayChase { id } => self.start_chase(&id, false),
            Message::StopChase => self.stop_chase(),
            Message::Audio { audio } => self.audio = audio.map(|feed| (feed, now)),
            Message::Action { action, press, value } => self.act(&action, press, value, now),
            Message::Tap { at } => {
                let at = at.filter(|a| a.is_finite()).map_or(now, |a| a.clamp(now - TAP_LATE_MS, now));
                self.tap.tap(at);
                let bpm = self.tap.bpm().map(|bpm| (bpm * 10.0).round() / 10.0);
                self.edit(|p| p.tap_bpm = bpm);
            }
            Message::ClearTap => {
                self.tap = Tap::default();
                self.edit(|p| p.tap_bpm = None);
            }
            Message::Fire { id, on } => self.fire_special(&id, on, now),
            Message::Arm { id, on } => {
                if self.doc.specials.iter().any(|s| s.id == id && s.needs_arm) {
                    let on = on.unwrap_or(!self.playback.armed.contains_key(&id));
                    self.edit(|p| {
                        if on {
                            p.armed.insert(id.clone(), now + ARM_MS);
                        } else {
                            p.armed.remove(&id);
                            p.firing.remove(&id);
                        }
                    });
                }
            }
            Message::Speed { value } => {
                if value.is_finite() {
                    self.edit(|p| p.speed = value.round().clamp(SPEED_MIN, SPEED_MAX));
                }
            }
            Message::PlayTimeline { id, from_ms } => self.play_timeline(&id, from_ms, now),
            Message::PauseTimeline => self.pause_timeline(now),
            Message::StopTimeline => self.stop_timeline(now),
            Message::TimelineSync { id, position_ms } => {
                let run = self.playback.timeline.as_ref().filter(|r| r.id == id && r.paused_at.is_none());
                if run.is_some_and(|r| position_ms.is_finite() && (r.position(now) - position_ms).abs() > SYNC_TOLERANCE_MS) {
                    self.edit(|p| {
                        if let Some(run) = p.timeline.as_mut() {
                            run.started_at = now - position_ms;
                        }
                    });
                }
            }
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
            "effect" => {
                if let Some(id) = command["id"].as_str() {
                    self.act(&Action::Effect { id: id.into() }, Some(true), None, now);
                }
            }
            "color" => {
                let text = |key: &str| command[key].as_str().map(str::to_owned);
                let action = Action::Color { group_id: text("group"), color: text("color") };
                self.act(&action, Some(true), None, now);
            }
            "tap" => {
                let _ = self.apply(Message::Tap { at: command["at"].as_f64() }, now);
            }
            "tapClear" => {
                let _ = self.apply(Message::ClearTap, now);
            }
            "speed" => {
                if let Some(value) = command["value"].as_f64() {
                    let _ = self.apply(Message::Speed { value }, now);
                }
            }
            "special" => {
                let special = self.doc.specials.iter().find(|s| Some(s.id.as_str()) == command["id"].as_str());
                if let Some(id) = special.map(|s| s.id.clone()) {
                    self.act(&Action::Special { id }, command["press"].as_bool(), None, now);
                }
            }
            "arm" => {
                if let Some(id) = command["id"].as_str() {
                    let _ = self.apply(Message::Arm { id: id.into(), on: command["on"].as_bool() }, now);
                }
            }
            "timeline" => match (command["id"].as_str(), command["play"].as_bool()) {
                (Some(id), Some(true)) => self.play_timeline(id, 0.0, now),
                (_, Some(false)) => self.stop_timeline(now),
                _ => {}
            },
            _ => {}
        }
    }

    /// Lo que manda el programa del DJ por OS2L (VirtualDJ): un golpe cada
    /// golpe, y sus botones (`os2l_button "Nombre"`), que lanzan lo que se
    /// llame así. Lo que no reconoce lo ignora.
    pub fn os2l(&mut self, message: &Value, now: f64) {
        match message["evt"].as_str() {
            Some("beat") => {
                let bpm = message["bpm"].as_f64().filter(|b| b.is_finite() && *b > 0.0);
                let (Some(bpm), Some(pos)) = (bpm, message["pos"].as_f64().filter(|p| p.is_finite())) else { return };
                // Hay quien la manda de 0 a 1 y quien en %.
                let strength = message["strength"].as_f64().filter(|s| s.is_finite() && *s >= 0.0).map_or(1.0, |s| {
                    if s > 1.0 { (s / 100.0).min(1.0) } else { s }
                });
                self.dj = Some(DjBeat { beats: pos, bpm, strength, at: now });
                let shown = Some((bpm * 10.0).round() / 10.0);
                if self.playback.dj_bpm != shown {
                    self.edit(|p| p.dj_bpm = shown);
                }
            }
            Some("btn") => {
                let Some(action) = message["name"].as_str().and_then(|name| self.action_named(name)) else { return };
                let on = message["state"].as_str() == Some("on");
                self.act(&action, Some(on), None, now);
            }
            _ => {}
        }
    }

    /// Lo que se llama así (sin importar mayúsculas): un momento, un efecto
    /// especial, un effect, una línea de tiempo, o una de las palabras de
    /// siempre (siguiente, anterior, blackout, estrobo, tap).
    fn action_named(&self, name: &str) -> Option<Action> {
        let name = name.trim().to_lowercase();
        let same = |other: &str| other.trim().to_lowercase() == name;
        let d = &self.doc;
        let found = d
            .moments
            .iter()
            .find(|m| same(&m.name))
            .map(|m| Action::Moment { id: m.id.clone() })
            .or_else(|| d.specials.iter().find(|s| same(&s.name)).map(|s| Action::Special { id: s.id.clone() }))
            .or_else(|| d.effects.iter().find(|e| same(&e.name)).map(|e| Action::Effect { id: e.id.clone() }))
            .or_else(|| d.timelines.iter().find(|t| same(&t.name)).map(|t| Action::Timeline { id: t.id.clone() }));
        found.or(match name.as_str() {
            "siguiente" | "next" => Some(Action::Next),
            "anterior" | "prev" => Some(Action::Prev),
            "blackout" => Some(Action::Blackout),
            "estrobo" | "strobe" => Some(Action::Strobe),
            "tap" => Some(Action::Tap),
            _ => None,
        })
    }

    /// Lo mismo venga de Live, del celular o de un controlador MIDI.
    pub fn act(&mut self, action: &Action, press: Option<bool>, value: Option<f64>, now: f64) {
        let pressed = press == Some(true);
        let value = value.filter(|v| v.is_finite()).map(|v| v.clamp(0.0, 1.0));
        let message = match action {
            Action::Strobe => press.map(|on| Message::Strobe { on }),
            // Un toque prende y otro apaga, o dispara mientras se aprieta.
            Action::Special { id } => {
                let latch = self.doc.specials.iter().any(|s| s.id == *id && s.latch);
                match (latch, press) {
                    (true, Some(true)) => Some(Message::Fire { id: id.clone(), on: !self.playback.firing.contains_key(id) }),
                    (true, _) => None,
                    (false, press) => press.map(|on| Message::Fire { id: id.clone(), on }),
                }
            }
            Action::Master => value.map(|v| Message::Master { value: v * 100.0 }),
            Action::Speed => value.map(|v| Message::Speed { value: speed_from_fader(v) }),
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
            Action::Color { group_id, color } if pressed => {
                let keys = match group_id {
                    Some(group) => vec![group.clone()],
                    None => self.color_rows().into_iter().map(|(key, _)| key).collect(),
                };
                let known = color.as_ref().filter(|hex| self.doc.colors.iter().any(|c| c.hex == **hex));
                if color.is_some() && known.is_none() {
                    return;
                }
                self.edit(|p| {
                    if group_id.is_none() && known.is_none() {
                        p.held_colors.clear();
                    }
                    for key in keys {
                        match known {
                            Some(hex) => p.held_colors.insert(key, hex.clone()),
                            None => p.held_colors.remove(&key),
                        };
                    }
                });
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
            Action::Tap => Some(Message::Tap { at: None }),
            Action::Arm { id } => Some(Message::Arm { id: id.clone(), on: None }),
            Action::Timeline { id } if self.timeline_playing(id) => Some(Message::StopTimeline),
            Action::Timeline { id } => Some(Message::PlayTimeline { id: id.clone(), from_ms: 0.0 }),
            Action::Blackout => Some(Message::Blackout { on: !self.playback.blackout_active }),
            Action::Palette { id } => {
                let values = self.doc.palettes.iter().find(|p| p.id == *id).map(|p| p.values.clone());
                values.map(|values| Message::Values { values })
            }
            Action::Color { .. } | Action::Nothing => None,
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
            Action::Timeline { id } => self.timeline_playing(id),
            Action::Tap => p.tap_bpm.is_some(),
            Action::Special { id } => p.firing.contains_key(id),
            Action::Arm { id } => p.armed.contains_key(id),
            Action::Color { group_id: Some(group), color } => p.held_colors.get(group) == color.as_ref(),
            Action::Color { group_id: None, color: None } => p.held_colors.is_empty(),
            Action::Color { group_id: None, color: Some(hex) } => {
                let rows = self.color_rows();
                !rows.is_empty() && rows.iter().all(|(key, _)| p.held_colors.get(key) == Some(hex))
            }
            _ => false,
        }
    }

    /// Los grupos que pueden tomar un color fijo, con su nombre, en el orden
    /// de Groups; al final "" (las luces sin grupo), si hay.
    fn color_rows(&self) -> Vec<(String, String)> {
        let Some(first) = self.doc.colors.first() else { return Vec::new() };
        let keys: Vec<&str> = self
            .doc
            .rig()
            .filter(|(i, _)| first.values.contains_key(&i.id))
            .map(|(i, _)| i.group.as_deref().unwrap_or(""))
            .collect();
        let mut rows: Vec<(String, String)> = self
            .doc
            .groups
            .iter()
            .filter(|g| keys.contains(&g.id.as_str()))
            .map(|g| (g.id.clone(), g.name.clone()))
            .collect();
        if keys.iter().any(|k| k.is_empty() || !self.doc.groups.iter().any(|g| g.id == *k)) {
            rows.push((String::new(), "Sin grupo".into()));
        }
        rows
    }

    /// Lo que pone el color fijo en cada luz.
    fn held(&self) -> ChannelValues {
        let held = &self.playback.held_colors;
        if held.is_empty() {
            return ChannelValues::new();
        }
        let known: Vec<&str> = self.doc.groups.iter().map(|g| g.id.as_str()).collect();
        self.doc
            .rig()
            .filter_map(|(i, _)| {
                // Un grupo borrado es como no tener grupo.
                let key = i.group.as_deref().filter(|g| known.contains(g)).unwrap_or("");
                let hex = held.get(key)?;
                let color = self.doc.colors.iter().find(|c| c.hex == *hex)?;
                Some((i.id.clone(), color.values.get(&i.id)?.clone()))
            })
            .collect()
    }

    /// Valor de un fader, 0–1.
    pub fn fader_value(&self, action: &Action) -> Option<f64> {
        match action {
            Action::Master => Some(self.playback.master / 100.0),
            Action::Speed => Some(fader_from_speed(self.playback.speed)),
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
                "hold": p.action == Action::Strobe || matches!(&p.action, Action::Special { id } if !self.is_latch(id)),
                "active": self.is_active(&p.action),
                "value": self.fader_value(&p.action),
            }))
            .collect::<Vec<_>>())
    }

    fn is_latch(&self, id: &str) -> bool {
        self.doc.specials.iter().any(|s| s.id == id && s.latch)
    }

    /// Dispara si está armado (o no lo pide), hasta su máximo.
    fn fire_special(&mut self, id: &str, on: bool, now: f64) {
        let Some(special) = self.doc.specials.iter().find(|s| s.id == id) else { return };
        if !on {
            return self.edit(|p| {
                p.firing.remove(id);
            });
        }
        if special.needs_arm && !self.playback.armed.contains_key(id) {
            return;
        }
        let max = if special.max_ms > 0.0 { special.max_ms } else { SPECIAL_DEFAULT_MS };
        self.edit(|p| {
            p.firing.insert(id.into(), now + max);
        });
    }

    /// Los canales de todos los efectos especiales: su valor mientras
    /// disparan, 0 si no.
    fn special_values(&self) -> ChannelValues {
        let mut values = ChannelValues::new();
        for special in self.doc.specials.iter().filter(|s| !s.instance_id.is_empty()) {
            let value = if self.playback.firing.contains_key(&special.id) { special.dmx() } else { 0 };
            values.entry(special.instance_id.clone()).or_default().insert(special.channel_id.clone(), value);
        }
        values
    }

    fn tick_specials(&mut self, now: f64) {
        let p = &self.playback;
        if p.firing.values().chain(p.armed.values()).any(|until| *until <= now) {
            self.edit(|p| {
                p.firing.retain(|_, until| *until > now);
                p.armed.retain(|_, until| *until > now);
            });
        }
    }

    fn start_effect(&mut self, id: String) {
        if self.doc.effects.iter().any(|e| e.id == id) && !self.playback.running_effect_ids.contains(&id) {
            self.edit(|p| p.running_effect_ids.push(id));
        }
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
        let colors = &self.doc.colors;
        let held: BTreeMap<String, String> =
            p.held_colors.iter().filter(|(_, hex)| colors.iter().any(|c| c.hex == **hex)).map(|(k, v)| (k.clone(), v.clone())).collect();
        let timelines = &self.doc.timelines;
        let timeline = p.timeline.clone().filter(|run| timelines.iter().any(|t| t.id == run.id));
        let specials = &self.doc.specials;
        let known = |id: &String| specials.iter().any(|s| s.id == *id);
        let firing: BTreeMap<String, f64> = p.firing.iter().filter(|(id, _)| known(id)).map(|(k, v)| (k.clone(), *v)).collect();
        let armed: BTreeMap<String, f64> = p.armed.iter().filter(|(id, _)| known(id)).map(|(k, v)| (k.clone(), *v)).collect();
        self.edit(|p| {
            p.running_effect_ids = running;
            p.active_scene_id = scene;
            p.active_moment_id = moment;
            p.held_colors = held;
            p.timeline = timeline;
            p.firing = firing;
            p.armed = armed;
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
            // El color fijo es para este momento: el siguiente trae los suyos.
            p.held_colors.clear();
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
                    self.start_effect(id.clone());
                }
                if let Some(chase) = &moment.chase_id {
                    self.start_chase(chase, true);
                }
            }
        }
        self.moment_fade = Some(current);

        // Con la canción sonando, ella dice cuándo cambiar de momento.
        if self.playback.timeline.as_ref().is_some_and(|run| run.paused_at.is_none()) {
            return;
        }
        let index = self.doc.moments.iter().position(|m| m.id == moment.id).unwrap_or(0);
        let next = self.doc.moments.get(index + 1).map(|m| m.id.clone());
        if let (Some(next), Some(seconds)) = (next, moment.duration_sec) {
            if elapsed >= seconds * 1000.0 {
                self.start_moment(&next, now);
            }
        }
    }

    // ------------------------------------------------------------------
    // Línea de tiempo
    // ------------------------------------------------------------------

    fn timeline_playing(&self, id: &str) -> bool {
        self.playback.timeline.as_ref().is_some_and(|run| run.id == id && run.paused_at.is_none())
    }

    /// Desde `from`, las luces quedan como si la canción hubiera sonado desde
    /// el principio: así se ensaya desde el estribillo.
    fn play_timeline(&mut self, id: &str, from: f64, now: f64) {
        let Some(timeline) = self.doc.timelines.iter().find(|t| t.id == id).cloned() else { return };
        let from = if from.is_finite() { from.clamp(0.0, timeline.end_ms()) } else { 0.0 };
        self.stop_moment();
        let started_at = now - from;
        self.edit(|p| {
            p.held_colors.clear();
            p.strobe_active = false;
            p.blackout_active = false;
            p.timeline = Some(TimelineRun { id: id.into(), started_at, paused_at: None });
        });
        self.timeline_cursor = f64::NEG_INFINITY;
        self.fire_until(&timeline, started_at, from);
    }

    fn pause_timeline(&mut self, now: f64) {
        let Some(run) = self.playback.timeline.clone().filter(|r| r.paused_at.is_none()) else { return };
        let position = run.position(now);
        self.end_held_cues(&run.id, position, now);
        self.edit(|p| {
            if let Some(run) = p.timeline.as_mut() {
                run.paused_at = Some(position);
            }
        });
    }

    /// Las luces quedan como están, salvo el estrobo o el apagón que la
    /// canción tenía puestos por un rato.
    fn stop_timeline(&mut self, now: f64) {
        let Some(run) = self.playback.timeline.clone() else { return };
        if run.paused_at.is_none() {
            self.end_held_cues(&run.id, run.position(now), now);
        }
        self.edit(|p| p.timeline = None);
    }

    /// Deshace las marcas con duración que están sonando en `position`.
    fn end_held_cues(&mut self, id: &str, position: f64, now: f64) {
        let Some(timeline) = self.doc.timelines.iter().find(|t| t.id == id) else { return };
        let held: Vec<Cue> = timeline
            .cues
            .iter()
            .filter(|c| c.at_ms < position && c.end_ms().is_some_and(|end| end >= position))
            .cloned()
            .collect();
        for cue in held {
            self.fire(&cue, Edge::End, now);
        }
    }

    /// Dispara lo que va de lo ya disparado hasta `to` (sin incluirlo).
    fn fire_until(&mut self, timeline: &Timeline, started_at: f64, to: f64) {
        let due: Vec<(f64, Edge, Cue)> = edges(timeline)
            .into_iter()
            .filter(|(at, _, _)| *at >= self.timeline_cursor && *at < to)
            .map(|(at, edge, cue)| (at, edge, cue.clone()))
            .collect();
        self.timeline_cursor = to;
        for (at, edge, cue) in due {
            self.fire(&cue, edge, started_at + at);
        }
    }

    /// `at` es la hora en que tocaba: un momento que se alcanza tarde (al
    /// empezar desde la mitad) ya llega con su fade hecho.
    fn fire(&mut self, cue: &Cue, edge: Edge, at: f64) {
        if edge == Edge::End {
            match &cue.action {
                Action::Effect { id } => self.edit(|p| p.running_effect_ids.retain(|e| e != id)),
                Action::Chase { id } if self.chase.as_ref().is_some_and(|c| c.id == *id) => self.stop_chase(),
                Action::Blackout => self.edit(|p| p.blackout_active = false),
                Action::Strobe => self.edit(|p| p.strobe_active = false),
                Action::Color { group_id, .. } => {
                    self.act(&Action::Color { group_id: group_id.clone(), color: None }, Some(true), None, at)
                }
                Action::Special { id } => self.fire_special(id, false, at),
                _ => {}
            }
            return;
        }
        let message = match &cue.action {
            Action::Moment { id } => Message::StartMoment { id: id.clone() },
            Action::Effect { id } => Message::StartEffect { id: id.clone() },
            Action::Chase { id } => Message::PlayChase { id: id.clone() },
            Action::Blackout => Message::Blackout { on: true },
            Action::Strobe => Message::Strobe { on: true },
            // Solo si está armado: la canción no arma nada sola.
            Action::Special { id } => Message::Fire { id: id.clone(), on: true },
            // Otra línea de tiempo desde una marca se pisaría con esta.
            Action::Timeline { .. }
            | Action::Arm { .. }
            | Action::Tap
            | Action::Master
            | Action::Speed
            | Action::GroupFader { .. }
            | Action::Nothing => return,
            other => return self.act(other, Some(true), None, at),
        };
        let _ = self.apply(message, at);
    }

    fn tick_timeline(&mut self, now: f64) {
        let Some(run) = self.playback.timeline.clone().filter(|r| r.paused_at.is_none()) else { return };
        let Some(timeline) = self.doc.timelines.iter().find(|t| t.id == run.id).cloned() else { return };
        let position = run.position(now);
        if position >= timeline.end_ms() {
            self.fire_until(&timeline, run.started_at, f64::INFINITY);
            self.edit(|p| p.timeline = None);
        } else {
            self.fire_until(&timeline, run.started_at, position);
        }
    }

    // ------------------------------------------------------------------
    // Chases
    // ------------------------------------------------------------------

    /// Uno a la vez: arrancar otro reemplaza al que esté sonando.
    fn start_chase(&mut self, id: &str, from_moment: bool) {
        let now = self.fx_clock;
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
        self.begin_step(0);
    }

    fn stop_chase(&mut self) {
        self.chase = None;
        self.edit(|p| p.chase = None);
    }

    /// Cambiar el chase del momento que está sonando se nota al instante.
    fn follow_moment_chase(&mut self) {
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
            self.start_chase(&id, true);
        }
    }

    /// El fade arranca desde lo que esté en vivo en ese momento, no desde el
    /// paso anterior "en teoría": si alguien movió algo a mano, no salta.
    fn begin_step(&mut self, index: usize) {
        let now = self.fx_clock;
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

    /// Con el reloj de los effects: la velocidad también lo apura o lo frena.
    fn tick_chase(&mut self) {
        let now = self.fx_clock;
        let Some(mut run) = self.chase.take() else { return };
        let Some(chase) = self.doc.chases.iter().find(|c| c.id == run.id) else { return self.stop_chase() };
        let (count, looped) = (chase.steps.len(), chase.looped);
        // Borraron el paso que sonaba: se sigue desde el principio.
        let Some(step) = chase.steps.get(run.step).cloned() else {
            self.chase = Some(run);
            return self.begin_step(0);
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
                self.begin_step(next);
            } else if looped {
                self.begin_step(0);
            } else {
                self.stop_chase();
            }
        }
    }

    // ------------------------------------------------------------------
    // Effects
    // ------------------------------------------------------------------

    fn dj(&self, now: f64) -> Option<DjBeat> {
        self.dj.filter(|dj| now - dj.at <= DJ_STALE_MS)
    }

    /// Con un ritmo marcado a mano (o el del DJ), cada golpe suena como un
    /// bombo.
    fn levels(&self, now: f64) -> Option<Levels> {
        if let Some(pulse) = self.tap.pulse(now) {
            return Some(Levels { bass: pulse, mid: pulse, treble: pulse });
        }
        if let Some(dj) = self.dj(now) {
            let beats = dj.beats(now);
            let pulse = (-6.0 * (beats - beats.floor())).exp() * dj.strength;
            return Some(Levels { bass: pulse, mid: pulse, treble: pulse });
        }
        let (feed, at) = self.audio.as_ref()?;
        (now - at <= LEVELS_STALE_MS).then_some(feed.levels)
    }

    fn beats(&self, now: f64) -> Option<f64> {
        if let Some(beats) = self.tap.beats(now) {
            return Some(beats);
        }
        if let Some(dj) = self.dj(now) {
            return Some(dj.beats(now));
        }
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
        let (levels, beats, fx) = (self.levels(now), self.beats(now), self.fx_clock);
        let mut writes = Vec::new();
        for id in running {
            let Some(effect) = self.doc.effects.iter().find(|e| e.id == *id) else { continue };
            let started = *self.effect_started.entry(id.clone()).or_insert(fx);
            if effect.kind != EffectKind::Wave {
                continue;
            }
            let Some(group) = &effect.group_id else { continue };
            let cycles = cycles_of(effect, started, beats, fx);
            let level = level_of(effect, levels);
            // Una barra de varios focos cuenta como varias luces seguidas; dos
            // que van juntas, como una sola.
            let members: Vec<_> = self.doc.rig().filter(|(i, _)| i.group.as_ref() == Some(group)).collect();
            let mut places: Vec<(&crate::model::Instance, usize)> = Vec::new();
            let mut next = 0;
            let cells = members.iter().flat_map(|&(member, definition)| {
                let cells = definition.cells(effect.channel_type);
                let base = match places.iter().find(|(other, _)| other.twin_of(member)) {
                    Some(&(_, base)) => base,
                    None => {
                        places.push((member, next));
                        next += cells.len();
                        next - cells.len()
                    }
                };
                cells.into_iter().enumerate().map(move |(n, cell)| (base + n, member, cell)).collect::<Vec<_>>()
            });
            for (index, member, channels) in cells {
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
    /// Barras y tiras de LEDs: el color de cada punto, en orden por el
    /// grupo (dos luces que van juntas, como una sola).
    fn tick_pixels(&mut self, now: f64) {
        let (levels, beats, fx) = (self.levels(now), self.beats(now), self.fx_clock);
        let mut writes: Vec<(String, String, u8)> = Vec::new();
        for id in &self.playback.running_effect_ids {
            let Some(effect) = self.doc.effects.iter().find(|e| e.id == *id && e.kind == EffectKind::Pixels) else { continue };
            let Some(group) = &effect.group_id else { continue };
            let started = self.effect_started.get(id).copied().unwrap_or(fx);
            let cycles = cycles_of(effect, started, beats, fx);
            let level = level_of(effect, levels);
            let color = crate::model::rgb_of(effect.color.as_deref());

            // Cada punto: sus canales rojo, verde, azul; sin color, su dimmer.
            let mut places: Vec<(&crate::model::Instance, usize)> = Vec::new();
            let mut pixels: Vec<Pixel> = Vec::new();
            let mut count = 0;
            for (instance, definition) in self.doc.rig().filter(|(i, _)| i.group.as_ref() == Some(group)) {
                let rgb = [ChannelType::Red, ChannelType::Green, ChannelType::Blue].map(|k| definition.cells(k));
                let heads: Vec<Vec<(usize, &Channel)>> = if rgb[0].iter().any(|c| !c.is_empty()) {
                    (0..rgb[0].len())
                        .map(|h| (0..3).flat_map(|k| rgb[k].get(h).into_iter().flatten().map(move |c| (k, *c))).collect())
                        .collect()
                } else {
                    definition.cells(ChannelType::Dimmer).into_iter().map(|cell| cell.into_iter().map(|c| (3, c)).collect()).collect()
                };
                let heads: Vec<_> = heads.into_iter().filter(|h: &Vec<(usize, &Channel)>| !h.is_empty()).collect();
                let base = match places.iter().find(|(other, _)| other.twin_of(instance)) {
                    Some(&(_, base)) => base,
                    None => {
                        places.push((instance, count));
                        count += heads.len();
                        count - heads.len()
                    }
                };
                pixels.extend(heads.into_iter().enumerate().map(|(n, head)| (base + n, instance, head)));
            }
            for (index, instance, channels) in pixels {
                let rgb = effect.pattern.color(index, count, cycles, level, color);
                for (k, channel) in channels {
                    // k 3: un punto sin color, por su brillo.
                    let t = if k == 3 { rgb.iter().copied().fold(0.0, f64::max) } else { rgb[k] };
                    let value = (effect.min + (effect.max - effect.min) * t).round().clamp(0.0, 255.0) as u8;
                    writes.push((instance.id.clone(), channel.id.clone(), value));
                }
            }
        }
        for (instance, channel, value) in writes {
            self.set_live(&instance, &channel, value);
        }
    }

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
            self.effect_started.entry(id.clone()).or_insert(self.fx_clock);
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
            let started = self.effect_started.get(id).copied().unwrap_or(self.fx_clock);
            let cycles = cycles_of(effect, started, beats, self.fx_clock);
            // Siguiendo la música, la figura crece con lo que suena.
            let size = effect.size_deg * smooth(*open) * level_of(effect, levels).unwrap_or(1.0);
            let (sin, cos) = effect.angle_deg.to_radians().sin_cos();

            // Dos cabezas que van juntas ocupan un solo lugar.
            let mut places: Vec<(&crate::model::Instance, usize)> = Vec::new();
            let mut count = 0;
            let mut heads = Vec::new();
            for (i, d) in self.doc.rig().filter(|(i, _)| i.group.as_ref() == Some(group)) {
                let axes = heads_of(d);
                let base = match places.iter().find(|(other, _)| other.twin_of(i)) {
                    Some(&(_, base)) => base,
                    None => {
                        places.push((i, count));
                        count += axes.len();
                        count - axes.len()
                    }
                };
                heads.extend(axes.into_iter().enumerate().map(|(n, axes)| (base + n, i, d, axes)));
            }
            for (index, instance, definition, axes) in heads {
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

    /// Adelanta el reloj de los effects según la velocidad.
    fn advance(&mut self, now: f64) {
        if self.clock_at == 0.0 {
            self.fx_clock = now;
        } else if now > self.clock_at {
            self.fx_clock += (now - self.clock_at) * self.playback.speed / 100.0;
        }
        self.clock_at = self.clock_at.max(now);
    }

    pub fn tick(&mut self, now: f64) {
        self.advance(now);
        self.tick_timeline(now);
        self.tick_specials(now);
        if self.playback.dj_bpm.is_some() && self.dj(now).is_none() {
            self.dj = None;
            self.edit(|p| p.dj_bpm = None);
        }
        self.tick_moment(now);
        self.tick_chase();
        self.tick_effects(now);
        self.tick_pixels(now);
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
            held: &self.held(),
            specials: &self.special_values(),
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
        // `now`: la hora del motor, para que la ventana ponga la canción donde va.
        let mut out = json!({ "rev": self.rev, "full": full, "now": self.last_tick });
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
            "speed": p.speed,
            "dmx": dmx,
            "pads": self.pads_snapshot(&self.doc.phone_pads),
            "tapBpm": p.tap_bpm,
            "specials": self
                .doc
                .specials
                .iter()
                .filter(|s| !s.instance_id.is_empty())
                .map(|s| json!({
                    "id": s.id,
                    "name": s.name,
                    "needsArm": s.needs_arm,
                    "latch": s.latch,
                    "armedUntil": p.armed.get(&s.id),
                    "firing": p.firing.contains_key(&s.id),
                }))
                .collect::<Vec<_>>(),
            "effects": self
                .doc
                .effects
                .iter()
                .filter(|e| e.group_id.is_some())
                .map(|e| json!({ "id": e.id, "name": e.name, "running": p.running_effect_ids.contains(&e.id) }))
                .collect::<Vec<_>>(),
            "timelines": self
                .doc
                .timelines
                .iter()
                .map(|t| json!({ "id": t.id, "name": t.name, "durationMs": t.end_ms() }))
                .collect::<Vec<_>>(),
            "timeline": p.timeline,
            "colors": {
                "choices": self.doc.colors.iter().map(|c| json!({ "hex": c.hex, "name": c.name })).collect::<Vec<_>>(),
                "rows": self
                    .color_rows()
                    .into_iter()
                    .map(|(key, name)| json!({ "id": key, "name": name, "held": p.held_colors.get(&key) }))
                    .collect::<Vec<_>>(),
            },
        })
    }
}
