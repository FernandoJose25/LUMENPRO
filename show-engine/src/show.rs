//! Lo que está pasando ahora: valores en vivo, momento, chase y effects. No
//! tiene reloj ni hilos: quien lo usa llama a `tick` con la hora en
//! milisegundos (la misma base que `Date.now()`).

use crate::frame::{self, Frame, Overlay};
use crate::model::{ChannelType, ChannelValues, Doc, EffectSource};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const IDENTIFY_MS: f64 = 3000.0;
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
            let fine_of = |kind: ChannelType| {
                let fine = definition.first(kind.fine()?)?;
                Some((fine, f64::from(*to.get(&fine.id)?)))
            };
            let joined: Vec<&str> = definition
                .channels
                .iter()
                .filter(|c| to.contains_key(&c.id))
                .filter_map(|c| Some(fine_of(c.kind)?.0.id.as_str()))
                .collect();
            for channel in &definition.channels {
                let Some(end) = to.get(&channel.id).map(|v| f64::from(*v)) else { continue };
                if joined.contains(&channel.id.as_str()) {
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
                if let Some((fine, fine_end)) = fine_of(channel.kind) {
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
    identify_until: f64,
    audio: Option<(AudioFeed, f64)>,
}

fn parse_doc(doc: &Value) -> Result<Doc, String> {
    Doc::deserialize(doc).map_err(|e| format!("El show no se entiende: {e}"))
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
        let doc = parse_doc(&session.doc)?;
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
                let parsed = parse_doc(&doc)?;
                let live = crate::model::values(live).unwrap_or_default();
                self.reset(doc, parsed, live);
                self.playback = Playback { active_scene_id, active_moment_id, ..Playback::default() };
                self.prune();
            }
            Message::Doc { doc } => {
                self.doc = parse_doc(&doc)?;
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
            _ => {}
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
        self.effect_started.retain(|id, _| running.contains(id));
        if running.is_empty() {
            return;
        }
        let (levels, beats) = (self.levels(now), self.beats(now));
        let mut writes = Vec::new();
        for id in running {
            let Some(effect) = self.doc.effects.iter().find(|e| e.id == *id) else { continue };
            let Some(group) = &effect.group_id else { continue };
            let started = *self.effect_started.entry(id.clone()).or_insert(now);

            let cycles = match beats.filter(|_| effect.source == EffectSource::Beat) {
                Some(beats) => beats / effect.beats_per_cycle.max(0.01),
                None => (now - started) / 1000.0 * effect.speed_cpm / 60.0,
            };
            let level = levels.and_then(|l| match effect.source {
                EffectSource::Bass => Some(l.bass),
                EffectSource::Mid => Some(l.mid),
                EffectSource::Treble => Some(l.treble),
                EffectSource::Clock | EffectSource::Beat => None,
            });
            let members = self.doc.instances.iter().filter(|i| i.group.as_ref() == Some(group));
            for (index, member) in members.enumerate() {
                let Some(definition) = self.doc.definition(&member.definition_id) else { continue };
                let phase = cycles + index as f64 * effect.phase_offset_deg / 360.0;
                let t = level.unwrap_or_else(|| effect.waveform.level(phase));
                let value = (effect.min + (effect.max - effect.min) * t).round().clamp(0.0, 255.0) as u8;
                for channel in definition.channels.iter().filter(|c| c.kind == effect.channel_type) {
                    writes.push((member.id.clone(), channel.id.clone(), value));
                }
            }
        }
        for (instance, channel, value) in writes {
            self.set_live(&instance, &channel, value);
        }
    }

    // ------------------------------------------------------------------
    // Salida
    // ------------------------------------------------------------------

    pub fn tick(&mut self, now: f64) {
        self.tick_moment(now);
        self.tick_chase(now);
        self.tick_effects(now);
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
        frame::build(&self.doc, &self.live, &overlay, universe)
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
        })
    }
}
