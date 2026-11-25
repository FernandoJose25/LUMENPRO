use lumenpro_show::{Message, Session, Show};
use serde_json::{json, Value};

const T0: f64 = 1_800_000_000_000.0;
const TICK: f64 = 20.0;

/// Show con una cabeza (canales 1–7) y dos PAR (33–37 y 43–47), y un reloj
/// que se mueve a mano.
struct Rig {
    show: Show,
    doc: Value,
    now: f64,
}

fn channel(id: &str, index: i32, kind: &str, default: i32) -> Value {
    json!({ "id": id, "index": index, "name": id, "type": kind, "dmxMin": 0, "dmxMax": 255,
            "defaultValue": default, "invert": false, "curve": "linear", "presets": [] })
}

impl Rig {
    fn new() -> Self {
        let doc = json!({
            "definitions": [
                { "id": "head", "channels": [
                    channel("pan", 1, "PAN", 128), channel("panf", 2, "PAN_FINE", 0), channel("tilt", 3, "TILT", 90),
                    channel("hdim", 4, "DIMMER", 0), channel("shutter", 5, "STROBE", 255), channel("gobo", 6, "GOBO", 0),
                ]},
                { "id": "par", "channels": [
                    channel("dim", 1, "DIMMER", 255), channel("red", 2, "RED", 0), channel("green", 3, "GREEN", 0),
                    channel("blue", 4, "BLUE", 0), channel("strobe", 5, "STROBE", 0),
                ]},
            ],
            "instances": [
                { "id": "h1", "definitionId": "head", "universe": 1, "address": 1 },
                { "id": "p1", "definitionId": "par", "universe": 1, "address": 33, "group": "pars" },
                { "id": "p2", "definitionId": "par", "universe": 1, "address": 43, "group": "pars" },
            ],
            "scenes": [
                { "id": "red", "values": { "p1": { "red": 200 } } },
                { "id": "strobe", "values": { "p1": { "red": 200, "strobe": 180 } } },
                { "id": "closed", "values": { "h1": { "shutter": 0, "gobo": 100, "hdim": 200 } } },
                { "id": "green", "values": { "p1": { "green": 250 } } },
                { "id": "base", "values": { "p1": { "green": 10 } } },
                { "id": "left", "values": { "h1": { "pan": 100, "panf": 200 } } },
                { "id": "right", "values": { "h1": { "pan": 101, "panf": 50 } } },
            ],
            "chases": [
                { "id": "c", "loop": true, "steps": [
                    { "id": "s1", "sceneId": "green", "fadeMs": 1000, "holdMs": 3000 },
                    { "id": "s2", "sceneId": "base", "fadeMs": 0, "holdMs": 1000 },
                ]},
                { "id": "once", "loop": false, "steps": [{ "id": "s3", "sceneId": "green", "fadeMs": 0, "holdMs": 500 }]},
                { "id": "empty", "loop": true, "steps": [] },
            ],
            "effects": [
                { "id": "fx", "groupId": "pars", "channelType": "RED", "waveform": "square", "speedCpm": 60,
                  "min": 11, "max": 222, "phaseOffsetDeg": 0, "source": "clock", "beatsPerCycle": 1 },
            ],
            "moments": [],
        });
        let mut rig = Self { show: Show::new(), doc, now: T0 };
        rig.reset();
        rig
    }

    fn reset(&mut self) {
        self.send(json!({ "type": "reset", "doc": self.doc, "live": {} }));
    }

    fn send(&mut self, message: Value) {
        self.show.apply(serde_json::from_value::<Message>(message).unwrap(), self.now).unwrap();
    }

    fn phone(&mut self, command: Value) {
        self.show.remote(&command, self.now);
    }

    fn run(&mut self, ms: f64) {
        let end = self.now + ms;
        while self.now < end {
            self.now = (self.now + TICK).min(end);
            self.show.tick(self.now);
        }
    }

    fn set(&mut self, instance: &str, channel: &str, value: u8) {
        self.send(json!({ "type": "values", "values": { instance: { channel: value } } }));
    }

    fn live(&self, instance: &str, channel: &str) -> u64 {
        self.show.changes(0)["values"][instance][channel].as_u64().unwrap_or(999)
    }

    fn playback(&self) -> Value {
        json!(self.show.session().playback)
    }

    fn moment(&mut self, id: &str, patch: Value) {
        let mut moment = json!({ "id": id, "name": id.to_uppercase(), "sceneId": null, "chaseId": null,
                                 "effectIds": [], "fadeMs": 0, "durationSec": null });
        for (k, v) in patch.as_object().unwrap() {
            moment[k] = v.clone();
        }
        self.doc["moments"].as_array_mut().unwrap().push(moment);
        self.send(json!({ "type": "doc", "doc": self.doc }));
    }

    fn start(&mut self, id: &str) {
        self.send(json!({ "type": "startMoment", "id": id }));
    }

    fn active(&self) -> Value {
        self.playback()["activeMomentId"].clone()
    }

    fn running(&self) -> Value {
        self.playback()["runningEffectIds"].clone()
    }
}

// --- Momentos ---------------------------------------------------------

#[test]
fn a_moment_fades_to_its_scene_and_lands_exactly() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "red", "fadeMs": 1000 }));
    r.start("a");
    r.run(500.0);
    assert_eq!(r.live("p1", "red"), 100);
    r.run(500.0);
    assert_eq!(r.live("p1", "red"), 200);
}

#[test]
fn a_fade_starts_from_what_is_really_coming_out_even_if_never_touched() {
    let mut r = Rig::new();
    r.doc["scenes"][0]["values"]["p1"]["dim"] = json!(0);
    r.reset();
    r.moment("a", json!({ "sceneId": "red", "fadeMs": 1000 }));
    r.start("a");
    r.run(500.0);
    assert_eq!(r.live("p1", "dim"), 128, "el dimmer sale de su default 255, no salta a 0");
}

#[test]
fn a_moment_cleans_what_the_previous_one_left() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "strobe" }));
    r.moment("b", json!({ "sceneId": "red" }));
    r.start("a");
    r.run(100.0);
    assert_eq!(r.live("p1", "strobe"), 180);
    r.start("b");
    r.run(100.0);
    assert_eq!((r.live("p1", "strobe"), r.live("p1", "red")), (0, 200));
}

#[test]
fn strobe_and_gobo_jump_instead_of_crossing_every_range() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "closed", "fadeMs": 1000 }));
    r.start("a");
    r.run(300.0);
    assert_eq!((r.live("h1", "shutter"), r.live("h1", "gobo")), (0, 100));
    assert!(r.live("h1", "hdim") < 100);
}

#[test]
fn pan_and_its_fine_channel_move_together() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "left" }));
    r.moment("b", json!({ "sceneId": "right", "fadeMs": 1000 }));
    r.start("a");
    r.run(100.0);
    r.start("b");
    let mut last = 100 * 256 + 200;
    for _ in 0..50 {
        r.run(20.0);
        let position = r.live("h1", "pan") * 256 + r.live("h1", "panf");
        assert!(position >= last && position <= 101 * 256 + 50, "retrocede: {last} → {position}");
        last = position;
    }
    assert_eq!(last, 101 * 256 + 50);
}

#[test]
fn without_a_scene_the_lights_stay() {
    let mut r = Rig::new();
    r.set("p1", "red", 77);
    r.moment("a", json!({ "fadeMs": 2000 }));
    r.start("a");
    r.run(3000.0);
    assert_eq!(r.live("p1", "red"), 77);
}

#[test]
fn a_moment_lifts_blackout_and_strobe_but_not_the_master() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.send(json!({ "type": "blackout", "on": true }));
    r.send(json!({ "type": "strobe", "on": true }));
    r.send(json!({ "type": "master", "value": 60 }));
    r.start("a");
    let p = r.playback();
    assert_eq!((&p["blackoutActive"], &p["strobeActive"], &p["master"]), (&json!(false), &json!(false), &json!(60.0)));
}

#[test]
fn effects_start_after_the_fade_and_stop_at_the_next_moment() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "base", "effectIds": ["fx"], "fadeMs": 1000 }));
    r.moment("b", json!({ "sceneId": "base" }));
    r.start("a");
    r.run(500.0);
    assert_eq!(r.running(), json!([]));
    r.run(700.0);
    assert_eq!(r.running(), json!(["fx"]));
    assert!([11, 222].contains(&r.live("p1", "red")));
    r.start("b");
    r.run(200.0);
    assert_eq!(r.running(), json!([]));
    assert_eq!(r.live("p1", "red"), 0);
}

#[test]
fn the_chase_starts_after_the_fade_and_the_next_moment_stops_it() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "base", "chaseId": "c", "fadeMs": 500 }));
    r.moment("b", json!({ "sceneId": "base" }));
    r.start("a");
    r.run(400.0);
    assert_eq!(r.playback()["chase"], json!(null));
    r.run(1800.0);
    assert_eq!(r.live("p1", "green"), 250);
    r.start("b");
    r.run(6000.0);
    assert_eq!(r.live("p1", "green"), 10);
    assert_eq!(r.playback()["chase"], json!(null));
}

#[test]
fn stop_cuts_effects_chase_and_auto_advance_and_leaves_the_lights() {
    let mut r = Rig::new();
    r.moment("a", json!({ "effectIds": ["fx"], "chaseId": "c", "durationSec": 2 }));
    r.moment("b", json!({}));
    r.start("a");
    r.run(500.0);
    let (red, green) = (r.live("p1", "red"), r.live("p1", "green"));
    r.send(json!({ "type": "stopMoment" }));
    r.run(10_000.0);
    assert_eq!((r.live("p1", "red"), r.live("p1", "green")), (red, green));
    assert_eq!((r.active(), r.running()), (json!("a"), json!([])));
    assert!(!r.show.is_playing());
}

#[test]
fn next_starts_at_the_first_and_does_nothing_at_the_last() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.moment("b", json!({}));
    for expected in ["a", "b", "b"] {
        r.send(json!({ "type": "stepMoment", "direction": 1 }));
        assert_eq!(r.active(), expected);
    }
    r.send(json!({ "type": "stepMoment", "direction": -1 }));
    r.send(json!({ "type": "stepMoment", "direction": -1 }));
    assert_eq!(r.active(), "a");
}

#[test]
fn durations_advance_one_by_one_and_the_one_without_waits() {
    let mut r = Rig::new();
    r.moment("a", json!({ "durationSec": 2 }));
    r.moment("b", json!({ "durationSec": 3 }));
    r.moment("c", json!({}));
    r.moment("d", json!({}));
    r.start("a");
    r.run(1980.0);
    assert_eq!(r.active(), "a");
    r.run(20.0);
    assert_eq!(r.active(), "b");
    r.run(2980.0);
    assert_eq!(r.active(), "b");
    r.run(20.0);
    assert_eq!(r.active(), "c");
    r.run(60_000.0);
    assert_eq!(r.active(), "c");
}

#[test]
fn restarting_the_same_moment_gets_a_new_nonce() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.start("a");
    let first = r.playback()["momentRun"]["nonce"].clone();
    r.start("a");
    assert_ne!(r.playback()["momentRun"]["nonce"], first);
}

// --- Chases -----------------------------------------------------------

#[test]
fn a_chase_fades_holds_cuts_and_loops() {
    let mut r = Rig::new();
    r.send(json!({ "type": "playChase", "id": "c" }));
    r.run(500.0);
    assert_eq!(r.live("p1", "green"), 125);
    assert_eq!(r.playback()["chase"]["phase"], "fade");
    r.run(600.0);
    assert_eq!(r.live("p1", "green"), 250);
    assert_eq!(r.playback()["chase"]["phase"], "hold");
    r.run(3000.0);
    assert_eq!(r.live("p1", "green"), 10, "un paso sin fade también se aplica");
    assert_eq!(r.playback()["chase"]["stepIndex"], 1);
    r.run(1500.0);
    assert_eq!(r.playback()["chase"]["stepIndex"], 0);
    r.send(json!({ "type": "stopChase" }));
    let green = r.live("p1", "green");
    r.run(5000.0);
    assert_eq!(r.live("p1", "green"), green);
}

#[test]
fn a_chase_without_loop_ends_alone_and_an_empty_one_does_not_start() {
    let mut r = Rig::new();
    r.send(json!({ "type": "playChase", "id": "once" }));
    assert!(r.show.is_playing());
    r.run(1000.0);
    assert_eq!(r.live("p1", "green"), 250);
    assert!(!r.show.is_playing());
    r.send(json!({ "type": "playChase", "id": "empty" }));
    assert!(!r.show.is_playing());
}

#[test]
fn deleting_the_step_or_the_chase_that_is_playing_does_not_hang() {
    let mut r = Rig::new();
    r.send(json!({ "type": "playChase", "id": "c" }));
    r.run(4100.0);
    assert_eq!(r.playback()["chase"]["stepIndex"], 1);
    r.doc["chases"][0]["steps"].as_array_mut().unwrap().pop();
    r.send(json!({ "type": "doc", "doc": r.doc }));
    r.run(100.0);
    assert_eq!(r.playback()["chase"]["stepIndex"], 0);
    r.doc["chases"] = json!([]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback()["chase"], json!(null));
}

#[test]
fn changing_the_chase_of_the_moment_that_is_playing_switches_it() {
    let mut r = Rig::new();
    r.moment("a", json!({ "chaseId": "c" }));
    r.start("a");
    r.run(100.0);
    r.doc["moments"][0]["chaseId"] = json!("once");
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback()["chase"]["id"], "once");
    r.doc["moments"][0]["chaseId"] = json!(null);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback()["chase"], json!(null));
}

// --- Effects y música -------------------------------------------------

#[test]
fn effects_spread_their_phase_and_restart_from_zero() {
    let mut r = Rig::new();
    r.doc["effects"][0]["waveform"] = json!("sawtooth");
    r.doc["effects"][0]["min"] = json!(0);
    r.doc["effects"][0]["max"] = json!(200);
    r.doc["effects"][0]["phaseOffsetDeg"] = json!(90);
    r.reset();
    r.send(json!({ "type": "startEffect", "id": "fx" }));
    r.run(20.0);
    assert_eq!((r.live("p1", "red"), r.live("p2", "red")), (0, 50));
    r.run(500.0);
    assert_eq!((r.live("p1", "red"), r.live("p2", "red")), (100, 150));
    r.send(json!({ "type": "stopEffect", "id": "fx" }));
    r.run(1000.0);
    assert_eq!(r.live("p1", "red"), 100);
    r.send(json!({ "type": "startEffect", "id": "fx" }));
    r.run(20.0);
    assert_eq!(r.live("p1", "red"), 0);
}

fn music(r: &mut Rig, source: &str) {
    r.doc["effects"][0]["source"] = json!(source);
    r.doc["effects"][0]["waveform"] = json!("sawtooth");
    r.doc["effects"][0]["min"] = json!(0);
    r.doc["effects"][0]["max"] = json!(200);
    r.reset();
    r.send(json!({ "type": "startEffect", "id": "fx" }));
}

#[test]
fn levels_drive_the_effect_and_when_the_audio_dies_it_goes_on_by_itself() {
    let mut r = Rig::new();
    music(&mut r, "bass");
    r.send(json!({ "type": "audio", "audio": { "levels": { "bass": 0.5, "mid": 0, "treble": 0 }, "beat": null } }));
    r.run(20.0);
    assert_eq!(r.live("p1", "red"), 100);
    r.run(2000.0);
    let before = r.live("p1", "red");
    r.run(300.0);
    assert_ne!(r.live("p1", "red"), before, "sin audio sigue con su velocidad propia");
}

#[test]
fn the_beat_clock_keeps_counting_a_while_if_the_window_hangs() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    r.send(json!({ "type": "audio", "audio": { "levels": { "bass": 0, "mid": 0, "treble": 0 },
                                               "beat": { "beats": 8.0, "bpm": 120 } } }));
    r.run(250.0); // medio golpe a 120 BPM
    assert_eq!(r.live("p1", "red"), 100);
    r.run(3000.0); // seis golpes justos
    assert_eq!(r.live("p1", "red"), 100);
    r.send(json!({ "type": "audio", "audio": null }));
    r.run(100.0);
    let before = r.live("p1", "red");
    r.run(300.0);
    assert_ne!(r.live("p1", "red"), before);
}

// --- Escenas, identificar, edición ------------------------------------

#[test]
fn recalling_a_scene_only_touches_what_it_saved_and_lifts_the_blackout() {
    let mut r = Rig::new();
    r.set("p1", "blue", 33);
    r.send(json!({ "type": "blackout", "on": true }));
    r.send(json!({ "type": "recallScene", "id": "red" }));
    assert_eq!((r.live("p1", "red"), r.live("p1", "blue")), (200, 33));
    assert_eq!(r.playback()["blackoutActive"], false);
    assert_eq!(r.playback()["activeSceneId"], "red");
    r.send(json!({ "type": "recallScene", "id": "no-existe" }));
    assert_eq!(r.playback()["activeSceneId"], "red");
}

#[test]
fn identify_turns_off_by_itself() {
    let mut r = Rig::new();
    r.send(json!({ "type": "identify", "id": "h1" }));
    assert_eq!(r.show.frame(1)[3], 255);
    r.run(2900.0);
    assert_eq!(r.show.frame(1)[3], 255);
    r.run(200.0);
    assert_eq!(r.show.frame(1)[3], 0);
}

#[test]
fn deleting_what_is_running_stops_it() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "red", "effectIds": ["fx"] }));
    r.start("a");
    r.run(100.0);
    r.doc["effects"] = json!([]);
    r.doc["scenes"] = json!([]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!((r.running(), &r.playback()["activeSceneId"]), (json!([]), &json!(null)));
    assert_ne!(r.playback()["momentRun"], json!(null));
    r.doc["moments"] = json!([]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!((&r.playback()["momentRun"], r.active()), (&json!(null), json!(null)));
}

#[test]
fn editing_the_show_does_not_restart_what_is_playing() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "base", "effectIds": ["fx"], "chaseId": "c" }));
    r.start("a");
    r.run(2000.0);
    let before = r.playback();
    r.doc["moments"][0]["name"] = json!("Otro nombre");
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback(), before);
}

#[test]
fn a_broken_show_is_rejected_and_the_current_one_goes_on() {
    let mut r = Rig::new();
    r.set("p1", "red", 50);
    let broken = json!({ "type": "doc", "doc": { "instances": "no" } });
    assert!(r.show.apply(serde_json::from_value(broken).unwrap(), T0).is_err());
    assert_eq!(r.show.frame(1)[33], 50);
}

#[test]
fn empty_numbers_and_unknown_channels_do_not_break_the_show() {
    let mut r = Rig::new();
    r.doc["instances"][0]["address"] = json!(null);
    r.doc["definitions"][1]["channels"][1]["type"] = json!("ALGO_NUEVO");
    r.doc["algoNuevo"] = json!({ "x": 1 });
    r.reset();
    r.set("p1", "red", 50);
    assert_eq!(r.show.frame(1)[33], 50);
}

// --- Celular ----------------------------------------------------------

#[test]
fn phone_next_and_prev_with_double_tap_protection() {
    let mut r = Rig::new();
    for id in ["a", "b", "c"] {
        r.moment(id, json!({}));
    }
    r.phone(json!({ "type": "next", "from": null }));
    assert_eq!(r.active(), "a");
    r.phone(json!({ "type": "next", "from": "a" }));
    r.phone(json!({ "type": "next", "from": "a" }));
    assert_eq!(r.active(), "b", "un doble toque no se salta un momento");
    r.phone(json!({ "type": "prev", "from": "b" }));
    assert_eq!(r.active(), "a");
}

#[test]
fn phone_blackout_strobe_master_and_stop() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.phone(json!({ "type": "moment", "id": "a" }));
    r.phone(json!({ "type": "blackout", "on": true }));
    r.phone(json!({ "type": "strobe", "on": true }));
    r.phone(json!({ "type": "master", "value": 40 }));
    let s = r.show.phone_snapshot("running");
    assert_eq!((&s["blackout"], &s["strobe"], &s["master"]), (&json!(true), &json!(true), &json!(40.0)));
    r.phone(json!({ "type": "stop" }));
    assert_eq!(r.show.phone_snapshot("running")["startedAt"], json!(null));
    r.phone(json!({ "type": "master", "value": 900 }));
    assert_eq!(r.playback()["master"], json!(100.0));
    r.phone(json!({ "type": "master", "value": -5 }));
    assert_eq!(r.playback()["master"], json!(0.0));
}

#[test]
fn phone_garbage_is_ignored() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    let before = r.playback();
    for command in [
        json!(null),
        json!("next"),
        json!(42),
        json!([]),
        json!({}),
        json!({ "type": "borrar" }),
        json!({ "type": "moment" }),
        json!({ "type": "moment", "id": "no-existe" }),
        json!({ "type": "master", "value": "50" }),
        json!({ "type": "master", "value": null }),
        json!({ "type": "blackout" }),
        json!({ "type": "strobe", "on": "si" }),
        json!({ "type": "next" }),
    ] {
        r.phone(command);
    }
    assert_eq!(r.playback(), before);
}

#[test]
fn phone_snapshot_has_only_what_the_page_shows() {
    let mut r = Rig::new();
    r.moment("a", json!({ "durationSec": 90 }));
    let s = r.show.phone_snapshot("stopped");
    let keys: Vec<_> = s.as_object().unwrap().keys().cloned().collect();
    assert_eq!(keys, ["activeId", "blackout", "dmx", "master", "moments", "startedAt", "strobe"]);
    assert_eq!(s["moments"], json!([{ "id": "a", "name": "A", "durationSec": 90.0 }]));
}

// --- Lo que ve la interfaz --------------------------------------------

#[test]
fn changes_only_carry_what_moved() {
    let mut r = Rig::new();
    r.set("p1", "red", 1);
    let seen = r.show.rev();
    r.set("p1", "red", 1);
    assert_eq!(r.show.rev(), seen, "escribir el mismo valor no es un cambio");
    r.set("p1", "green", 2);
    let c = r.show.changes(seen);
    assert_eq!(c["values"], json!({ "p1": { "green": 2 } }));
    assert_eq!((&c["full"], c.get("playback")), (&json!(false), None));
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.changes(seen)["playback"]["blackoutActive"], true);
}

#[test]
fn another_show_or_another_engine_sends_everything() {
    let mut r = Rig::new();
    r.set("p1", "red", 9);
    let seen = r.show.rev();
    r.reset();
    let c = r.show.changes(seen);
    assert_eq!((&c["full"], &c["values"]), (&json!(true), &json!({})));
    assert_eq!(r.show.changes(999_999)["full"], true);
}

#[test]
fn a_session_resumes_where_it_was() {
    let mut r = Rig::new();
    r.moment("a", json!({ "sceneId": "base", "effectIds": ["fx"], "chaseId": "c", "fadeMs": 500, "durationSec": 60 }));
    r.moment("b", json!({}));
    r.start("a");
    r.run(6000.0);
    r.send(json!({ "type": "master", "value": 70 }));
    let (frame, playback) = (r.show.frame(1), r.playback());

    let saved = serde_json::to_string(&r.show.session()).unwrap();
    let mut again = Show::new();
    again.restore(serde_json::from_str::<Session>(&saved).unwrap(), r.now).unwrap();
    assert_eq!(again.frame(1), frame);
    let p = json!(again.session().playback);
    for key in ["runningEffectIds", "master", "activeMomentId", "momentRun"] {
        assert_eq!(p[key], playback[key], "{key}");
    }
    assert_eq!(p["chase"]["stepIndex"], playback["chase"]["stepIndex"]);

    r.show = again;
    r.run(400.0);
    assert_eq!(r.running(), json!(["fx"]));
    r.run(54_000.0);
    assert_eq!(r.active(), "b", "el avance automático conserva su hora");
}
