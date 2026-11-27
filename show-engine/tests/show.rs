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
fn levels_drive_the_effect_and_without_music_it_stays_at_its_minimum() {
    let mut r = Rig::new();
    music(&mut r, "bass");
    r.run(300.0);
    assert_eq!(r.live("p1", "red"), 0, "sin escuchar, en su mínimo");
    r.send(json!({ "type": "audio", "audio": { "levels": { "bass": 0.5, "mid": 0, "treble": 0 }, "beat": null } }));
    r.run(20.0);
    assert_eq!(r.live("p1", "red"), 100);
    // Se dejó de escuchar (o la ventana no manda nada): silencio.
    r.run(2000.0);
    assert_eq!(r.live("p1", "red"), 0);
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
    assert_eq!(
        keys,
        ["activeId", "blackout", "colors", "dmx", "effects", "master", "moments", "pads", "specials", "speed", "startedAt", "strobe", "tapBpm", "timeline", "timelines"]
    );
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

// --- Equipos de la biblioteca ------------------------------------------

/// Una sola unidad en la dirección 1.
fn single(definition: Value) -> Rig {
    let mut r = Rig::new();
    r.doc["definitions"] = json!([definition]);
    r.doc["definitions"][0]["id"] = json!("d");
    r.doc["instances"] = json!([{ "id": "u", "definitionId": "d", "universe": 1, "address": 1, "group": "g" }]);
    r.reset();
    r
}

fn with(mut channel: Value, patch: Value) -> Value {
    for (k, v) in patch.as_object().unwrap() {
        channel[k] = v.clone();
    }
    channel
}

/// Barra de tres focos RGB con dimmer general y uno por foco.
fn bar() -> Value {
    let mut channels = vec![with(channel("m", 1, "DIMMER", 255), json!({ "master": true }))];
    let mut heads = Vec::new();
    for h in 0..3 {
        let at = 2 + h * 2;
        channels.push(channel(&format!("d{h}"), at, "DIMMER", 255));
        channels.push(channel(&format!("r{h}"), at + 1, "RED", 0));
        heads.push(json!([format!("d{h}"), format!("r{h}")]));
    }
    json!({ "channels": channels, "heads": heads, "kind": "LED Bar (Pixels)" })
}

#[test]
fn a_bar_lowers_once_with_the_master_and_goes_dark_whole() {
    let mut r = single(bar());
    r.send(json!({ "type": "master", "value": 50 }));
    let f = r.show.frame(1);
    assert_eq!((f[0], f[1], f[3], f[5]), (128, 255, 255, 255));
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.frame(1)[..7], [0; 7]);
}

#[test]
fn an_effect_runs_along_the_heads_of_a_bar() {
    let mut r = single(bar());
    r.doc["effects"][0]["groupId"] = json!("g");
    r.doc["effects"][0]["waveform"] = json!("sawtooth");
    r.doc["effects"][0]["min"] = json!(0);
    r.doc["effects"][0]["max"] = json!(200);
    r.doc["effects"][0]["phaseOffsetDeg"] = json!(90);
    r.reset();
    r.send(json!({ "type": "startEffect", "id": "fx" }));
    r.run(20.0);
    assert_eq!([r.live("u", "r0"), r.live("u", "r1"), r.live("u", "r2")], [0, 50, 100]);
}

#[test]
fn dimmer_packs_lower_every_output() {
    let mut r = single(json!({ "channels": [channel("a", 1, "DIMMER", 200), channel("b", 2, "DIMMER", 100)] }));
    r.send(json!({ "type": "master", "value": 50 }));
    assert_eq!(r.show.frame(1)[..2], [100, 50]);
}

#[test]
fn cmy_filters_are_not_light_but_led_colors_are() {
    let cmy = [channel("c", 1, "CYAN", 40), channel("m", 2, "MAGENTA", 40), channel("y", 3, "YELLOW", 40)];
    let mut head = cmy.to_vec();
    head.push(channel("dim", 4, "DIMMER", 255));
    let mut r = single(json!({ "channels": head }));
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.frame(1)[..4], [40, 40, 40, 0]);

    let leds = ["RED", "AMBER", "UV", "LIME", "YELLOW"];
    let channels: Vec<Value> = leds.iter().enumerate().map(|(i, k)| channel(k, i as i32 + 1, k, 200)).collect();
    let mut r = single(json!({ "channels": channels }));
    r.send(json!({ "type": "master", "value": 50 }));
    assert_eq!(r.show.frame(1)[..5], [100; 5]);
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.frame(1)[..5], [0; 5]);
}

#[test]
fn identifying_or_lowering_the_light_never_fires_the_smoke() {
    let mut r = single(json!({ "channels": [channel("smoke", 1, "DIMMER", 0)], "kind": "Smoke" }));
    r.send(json!({ "type": "identify", "id": "u" }));
    assert_eq!(r.show.frame(1)[0], 0);
    r.set("u", "smoke", 200);
    r.send(json!({ "type": "master", "value": 10 }));
    assert_eq!(r.show.frame(1)[0], 200);
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.frame(1)[0], 0);
}

#[test]
fn a_16_bit_dimmer_uses_its_fine_channel_to_fade_smoothly() {
    let mut r = single(json!({ "channels": [
        channel("dim", 1, "DIMMER", 255), with(channel("fine", 2, "FINE", 0), json!({ "fineOf": "dim" })),
    ]}));
    r.set("u", "dim", 101);
    r.send(json!({ "type": "master", "value": 50 }));
    assert_eq!(r.show.frame(1)[..2], [50, 128]);
    r.send(json!({ "type": "master", "value": 100 }));
    assert_eq!(r.show.frame(1)[..2], [101, 0]);
    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(r.show.frame(1)[..2], [0, 0]);
}

#[test]
fn each_head_of_a_multi_head_fixture_keeps_its_own_fine_channel() {
    let mut r = single(json!({ "channels": [
        channel("p1", 1, "PAN", 10), with(channel("p1f", 2, "PAN_FINE", 20), json!({ "fineOf": "p1" })),
        channel("p2", 3, "PAN", 30), with(channel("p2f", 4, "PAN_FINE", 40), json!({ "fineOf": "p2" })),
    ]}));
    assert_eq!(r.show.frame(1)[..4], [10, 20, 30, 40]);
    r.doc["instances"][0]["panInvert"] = json!(true);
    r.reset();
    assert_eq!(r.show.frame(1)[..4], [245, 235, 225, 215]);
}

#[test]
fn the_strobe_button_uses_the_range_the_profile_marks() {
    let shutter = with(channel("s", 1, "STROBE", 255), json!({ "presets": [
        { "id": "a", "label": "Closed", "kind": "closed", "dmxFrom": 0, "dmxTo": 7 },
        { "id": "b", "label": "Slow to fast", "kind": "strobe", "dmxFrom": 100, "dmxTo": 200 },
    ]}));
    let mut r = single(json!({ "channels": [shutter, channel("pan", 2, "PAN", 128)] }));
    r.send(json!({ "type": "strobe", "on": true }));
    assert_eq!(r.show.frame(1)[0], 175);
}

// --- Figuras ------------------------------------------------------------

/// Dos cabezas de 16 bits con pan de 512° y tilt de 256°: 128 pasos de 16 bits
/// por grado de pan y 256 por grado de tilt.
fn heads(figure: &str, patch: Value) -> Rig {
    let mut r = Rig::new();
    r.doc["definitions"] = json!([{
        "id": "head", "panLimit": { "min": 0, "max": 512 }, "tiltLimit": { "min": 0, "max": 256 },
        "channels": [
            channel("pan", 1, "PAN", 128), channel("panf", 2, "PAN_FINE", 0),
            channel("tilt", 3, "TILT", 128), channel("tiltf", 4, "TILT_FINE", 0),
        ],
    }]);
    r.doc["instances"] = json!([
        { "id": "a", "definitionId": "head", "universe": 1, "address": 1, "group": "g" },
        { "id": "b", "definitionId": "head", "universe": 1, "address": 11, "group": "g" },
    ]);
    let mut effect = json!({ "id": "fig", "groupId": "g", "kind": "figure", "figure": figure, "sizeDeg": 20,
        "angleDeg": 0, "speedCpm": 60, "phaseOffsetDeg": 0, "source": "clock", "beatsPerCycle": 1 });
    for (k, v) in patch.as_object().unwrap() {
        effect[k] = v.clone();
    }
    r.doc["effects"] = json!([effect]);
    r.reset();
    r
}

/// Grados de pan y tilt respecto del centro, según lo que sale por el cable.
fn aim(r: &Rig, address: usize) -> (f64, f64) {
    let f = r.show.frame(1);
    let axis = |at: usize| f64::from(f[at]) * 256.0 + f64::from(f[at + 1]) - 32768.0;
    (axis(address - 1) / 128.0, axis(address + 1) / 256.0)
}

/// Un ciclo completo, ya abierta.
fn trace(r: &mut Rig) -> Vec<(f64, f64)> {
    r.send(json!({ "type": "startEffect", "id": "fig" }));
    r.run(2000.0);
    (0..50)
        .map(|_| {
            r.run(20.0);
            aim(r, 1)
        })
        .collect()
}

fn extent(points: &[(f64, f64)]) -> (f64, f64) {
    let span = |f: fn(&(f64, f64)) -> f64| {
        points.iter().map(f).fold(f64::MIN, f64::max) - points.iter().map(f).fold(f64::MAX, f64::min)
    };
    (span(|p| p.0), span(|p| p.1))
}

#[test]
fn a_circle_is_round_complete_and_smooth() {
    let mut r = heads("circle", json!({}));
    let points = trace(&mut r);
    for (pan, tilt) in &points {
        assert!((pan.hypot(*tilt) - 20.0).abs() < 0.05, "{pan} {tilt}");
    }
    let quadrants: std::collections::BTreeSet<_> = points.iter().map(|p| (p.0 > 0.0, p.1 > 0.0)).collect();
    assert_eq!(quadrants.len(), 4);
    for w in points.windows(2) {
        assert!((w[1].0 - w[0].0).hypot(w[1].1 - w[0].1) < 3.0, "salto");
    }
}

#[test]
fn an_eight_crosses_the_center_and_a_line_stays_on_its_axis() {
    let points = trace(&mut heads("eight", json!({})));
    let (pan, tilt) = extent(&points);
    assert!((pan - 40.0).abs() < 0.2 && (tilt - 20.0).abs() < 0.2, "{pan} {tilt}");
    assert!(points.iter().filter(|p| p.0.hypot(p.1) < 1.5).count() >= 2);

    let (pan, tilt) = extent(&trace(&mut heads("line", json!({}))));
    assert!((pan - 40.0).abs() < 0.2 && tilt < 0.01);
    let (pan, tilt) = extent(&trace(&mut heads("line", json!({ "angleDeg": 90 }))));
    assert!(pan < 0.05 && (tilt - 40.0).abs() < 0.2, "girada va en tilt: {pan} {tilt}");
}

#[test]
fn a_fan_opens_symmetrically() {
    let mut r = heads("fan", json!({ "speedCpm": 60 }));
    r.send(json!({ "type": "startEffect", "id": "fig" }));
    r.run(2500.0); // a media vuelta: abierto del todo
    let (a, b) = (aim(&r, 1), aim(&r, 11));
    assert!((a.0 + 20.0).abs() < 0.3 && (b.0 - 20.0).abs() < 0.3, "{a:?} {b:?}");
    r.run(500.0);
    assert!(aim(&r, 1).0.abs() < 0.3);
}

#[test]
fn the_phase_offset_spreads_the_heads_along_the_figure() {
    let mut r = heads("circle", json!({ "phaseOffsetDeg": 180 }));
    trace(&mut r);
    let (a, b) = (aim(&r, 1), aim(&r, 11));
    assert!((a.0 + b.0).abs() < 0.1 && (a.1 + b.1).abs() < 0.1);
}

#[test]
fn a_figure_opens_and_closes_softly_and_leaves_the_faders_where_they_were() {
    let mut r = heads("circle", json!({}));
    r.send(json!({ "type": "startEffect", "id": "fig" }));
    r.run(20.0);
    assert!(aim(&r, 1).0.hypot(aim(&r, 1).1) < 0.5, "no arranca de un salto");
    r.run(2000.0);
    assert_eq!(r.live("a", "pan"), 999, "los valores en vivo no se tocan");
    r.send(json!({ "type": "stopEffect", "id": "fig" }));
    let before = aim(&r, 1);
    r.run(20.0);
    let after = aim(&r, 1);
    assert!((after.0 - before.0).hypot(after.1 - before.1) < 4.0, "no frena de un salto");
    r.run(1500.0);
    assert_eq!(aim(&r, 1), (0.0, 0.0));
    assert_eq!(r.show.changes(0)["moving"], json!({}));
}

#[test]
fn the_center_can_be_moved_while_it_draws() {
    let mut r = heads("circle", json!({}));
    trace(&mut r);
    r.send(json!({ "type": "values", "values": { "a": { "pan": 158, "panf": 0 } } })); // +60°
    r.run(20.0);
    let points: Vec<_> = (0..50).map(|_| { r.run(20.0); aim(&r, 1).0 }).collect();
    let middle = points.iter().sum::<f64>() / 50.0;
    assert!((middle - 60.0).abs() < 0.5, "{middle}");
}

#[test]
fn at_the_end_of_its_travel_a_head_stops_instead_of_wrapping_around() {
    let mut r = heads("line", json!({ "sizeDeg": 90 }));
    r.send(json!({ "type": "values", "values": { "a": { "pan": 250, "panf": 0 } } }));
    for (pan, _) in trace(&mut r) {
        assert!(pan > 100.0, "dio la vuelta: {pan}");
    }
}

#[test]
fn two_figures_add_up_and_a_moment_change_closes_them() {
    let mut r = heads("line", json!({}));
    let mut second = r.doc["effects"][0].clone();
    second["id"] = json!("fig2");
    second["angleDeg"] = json!(90);
    r.doc["effects"].as_array_mut().unwrap().push(second);
    r.doc["moments"] = json!([
        { "id": "m1", "name": "A", "effectIds": ["fig", "fig2"], "fadeMs": 0 },
        { "id": "m2", "name": "B", "effectIds": [], "fadeMs": 0 },
    ]);
    r.reset();
    r.start("m1");
    r.run(2000.0);
    let points: Vec<_> = (0..50).map(|_| { r.run(20.0); aim(&r, 1) }).collect();
    let (pan, tilt) = extent(&points);
    assert!((pan - 40.0).abs() < 0.3 && (tilt - 40.0).abs() < 0.3);
    r.start("m2");
    r.run(1500.0);
    assert_eq!(aim(&r, 1), (0.0, 0.0));
}

#[test]
fn an_8_bit_head_and_the_mount_inversion_also_work() {
    let mut r = heads("line", json!({}));
    r.doc["definitions"][0]["channels"] = json!([channel("pan", 1, "PAN", 128), channel("tilt", 2, "TILT", 128)]);
    r.doc["instances"][1]["panInvert"] = json!(true);
    r.reset();
    r.send(json!({ "type": "startEffect", "id": "fig" }));
    r.run(2250.0); // un cuarto de vuelta: en la punta
    let f = r.show.frame(1);
    assert_eq!((f[0], f[10]), (138, 117));
}

#[test]
fn following_the_bass_the_figure_grows_with_it() {
    let mut r = heads("circle", json!({ "source": "bass" }));
    r.send(json!({ "type": "startEffect", "id": "fig" }));
    for (bass, radius) in [(1.0, 20.0), (0.25, 5.0)] {
        for _ in 0..80 {
            r.send(json!({ "type": "audio", "audio": { "levels": { "bass": bass, "mid": 0, "treble": 0 }, "beat": null } }));
            r.run(20.0);
        }
        let (pan, tilt) = aim(&r, 1);
        assert!((pan.hypot(tilt) - radius).abs() < 0.1);
    }
}

// --- Paletas -------------------------------------------------------------

#[test]
fn correcting_a_palette_changes_every_scene_that_uses_it() {
    let mut r = heads("circle", json!({}));
    r.doc["palettes"] = json!([{ "id": "floor", "name": "Pista", "values": { "a": { "pan": 10 }, "b": { "pan": 20 } } }]);
    r.doc["scenes"] = json!([
        { "id": "s1", "values": { "a": { "pan": 1, "tilt": 7 } }, "refs": { "a": { "position": "floor" } } },
        { "id": "s2", "values": { "b": { "pan": 1 } }, "refs": { "b": { "position": "floor" } } },
        { "id": "s3", "values": { "a": { "pan": 99 } } },
    ]);
    r.reset();
    r.send(json!({ "type": "recallScene", "id": "s1" }));
    assert_eq!((r.live("a", "pan"), r.live("a", "tilt")), (10, 7));

    r.doc["palettes"][0]["values"] = json!({ "a": { "pan": 55 }, "b": { "pan": 66 } });
    r.send(json!({ "type": "doc", "doc": r.doc }));
    r.send(json!({ "type": "recallScene", "id": "s1" }));
    r.send(json!({ "type": "recallScene", "id": "s2" }));
    assert_eq!((r.live("a", "pan"), r.live("b", "pan")), (55, 66));
    r.send(json!({ "type": "recallScene", "id": "s3" }));
    assert_eq!(r.live("a", "pan"), 99, "las que no la usan no cambian");
}

#[test]
fn a_scene_that_points_to_a_deleted_palette_keeps_what_it_saved() {
    let mut r = heads("circle", json!({}));
    r.doc["scenes"] = json!([{ "id": "s", "values": { "a": { "pan": 12 } }, "refs": { "a": { "position": "nada" } } }]);
    r.reset();
    r.send(json!({ "type": "recallScene", "id": "s" }));
    assert_eq!(r.live("a", "pan"), 12);
}

// --- Botones, celular y MIDI ----------------------------------------------

fn act(r: &mut Rig, action: Value, press: Option<bool>, value: Option<f64>) {
    r.send(json!({ "type": "action", "action": action, "press": press, "value": value }));
}

#[test]
fn buttons_act_on_press_and_toggles_switch() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.moment("b", json!({}));
    act(&mut r, json!({ "do": "next" }), Some(true), None);
    act(&mut r, json!({ "do": "next" }), Some(false), None);
    assert_eq!(r.active(), "a", "soltar no vuelve a avanzar");
    act(&mut r, json!({ "do": "moment", "id": "b" }), Some(true), None);
    assert_eq!(r.active(), "b");
    for expected in [true, false] {
        act(&mut r, json!({ "do": "effect", "id": "fx" }), Some(true), None);
        assert_eq!(r.running() == json!(["fx"]), expected);
        act(&mut r, json!({ "do": "blackout" }), Some(true), None);
        assert_eq!(r.playback()["blackoutActive"], expected);
        act(&mut r, json!({ "do": "chase", "id": "c" }), Some(true), None);
        assert_eq!(r.playback()["chase"]["id"] == "c", expected);
    }
}

#[test]
fn the_strobe_lasts_while_held_and_faders_take_values() {
    let mut r = Rig::new();
    act(&mut r, json!({ "do": "strobe" }), Some(true), None);
    assert_eq!(r.playback()["strobeActive"], true);
    act(&mut r, json!({ "do": "strobe" }), Some(false), None);
    assert_eq!(r.playback()["strobeActive"], false);
    act(&mut r, json!({ "do": "master" }), None, Some(0.5));
    assert_eq!(r.playback()["master"], 50.0);
    act(&mut r, json!({ "do": "groupFader", "groupId": "pars", "channelType": "RED" }), None, Some(1.0));
    assert_eq!((r.live("p1", "red"), r.live("p2", "red"), r.live("h1", "pan")), (255, 255, 999));
    act(&mut r, json!({ "do": "algo nuevo" }), Some(true), Some(1.0));
}

#[test]
fn a_palette_button_puts_it_everywhere_it_has_values() {
    let mut r = Rig::new();
    r.doc["palettes"] = json!([{ "id": "rosa", "values": { "p1": { "red": 255, "blue": 140 } } }]);
    r.reset();
    act(&mut r, json!({ "do": "palette", "id": "rosa" }), Some(true), None);
    assert_eq!((r.live("p1", "red"), r.live("p1", "blue")), (255, 140));
}

#[test]
fn the_phone_shows_its_buttons_lit_and_presses_them() {
    let mut r = Rig::new();
    r.moment("a", json!({}));
    r.doc["phonePads"] = json!([
        { "id": "x", "label": "Hora loca", "action": { "do": "moment", "id": "a" }, "size": 2 },
        { "id": "y", "label": "Estrobo", "action": { "do": "strobe" }, "size": 1 },
        { "id": "z", "label": "Intensidad", "action": { "do": "master" }, "size": 1 },
    ]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    r.phone(json!({ "type": "pad", "id": "x", "press": true }));
    r.phone(json!({ "type": "pad", "id": "y", "press": true }));
    r.phone(json!({ "type": "pad", "id": "z", "value": 0.3 }));
    let pads = r.show.phone_snapshot("running")["pads"].clone();
    assert_eq!(pads[0]["active"], true);
    assert_eq!((&pads[1]["active"], &pads[1]["hold"]), (&json!(true), &json!(true)));
    assert_eq!((&pads[2]["fader"], &pads[2]["value"]), (&json!(true), &json!(0.3)));
    r.phone(json!({ "type": "pad", "id": "nada", "press": true }));
}

// --- Color fijo y luces que van juntas --------------------------------

fn with_colors(r: &mut Rig) {
    let rgb = |red: u8, blue: u8| json!({ "red": red, "green": 0, "blue": blue });
    r.doc["groups"] = json!([{ "id": "pars", "name": "PAR" }]);
    r.doc["colors"] = json!([
        { "hex": "#ff0000", "name": "Rojo", "values": { "p1": rgb(255, 0), "p2": rgb(255, 0) } },
        { "hex": "#0000ff", "name": "Azul", "values": { "p1": rgb(0, 255), "p2": rgb(0, 255) } },
    ]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
}

/// Rojo, verde y azul de p1 tal como salen por el cable.
fn p1_rgb(r: &Rig) -> [u8; 3] {
    let frame = r.show.frame(1);
    [frame[33], frame[34], frame[35]]
}

#[test]
fn a_held_color_wins_over_moments_and_effects_and_lets_go_without_a_trace() {
    let mut r = Rig::new();
    with_colors(&mut r);
    r.moment("a", json!({ "sceneId": "green", "effectIds": ["fx"] }));
    r.moment("b", json!({ "sceneId": "red" }));
    r.start("a");
    r.run(100.0);
    act(&mut r, json!({ "do": "color", "groupId": "pars", "color": "#0000ff" }), Some(true), None);
    assert_eq!(p1_rgb(&r), [0, 0, 255]);
    // El effect sigue por debajo, sin verse.
    assert_eq!(r.running(), json!(["fx"]));
    r.run(700.0);
    assert_eq!(p1_rgb(&r), [0, 0, 255]);

    // "Del momento": vuelve lo que el momento tenía.
    act(&mut r, json!({ "do": "color", "groupId": "pars", "color": null }), Some(true), None);
    assert_eq!(r.playback()["heldColors"], json!({}));
    r.run(700.0);
    assert_ne!(p1_rgb(&r), [0, 0, 255]);
    assert_eq!(r.doc["scenes"][3]["values"], json!({ "p1": { "green": 250 } }));
}

#[test]
fn the_held_color_lasts_until_the_next_moment() {
    let mut r = Rig::new();
    with_colors(&mut r);
    r.moment("a", json!({ "sceneId": "green" }));
    r.moment("b", json!({ "sceneId": "red" }));
    r.start("a");
    r.run(100.0);
    act(&mut r, json!({ "do": "color", "groupId": "pars", "color": "#0000ff" }), Some(true), None);
    r.run(100.0);
    assert_eq!(p1_rgb(&r), [0, 0, 255]);
    r.start("b");
    r.run(100.0);
    assert_eq!(p1_rgb(&r), [200, 0, 0]);
    assert_eq!(r.playback()["heldColors"], json!({}));
}

#[test]
fn a_color_effect_turned_on_by_hand_wins_over_the_held_color() {
    let mut r = Rig::new();
    with_colors(&mut r);
    r.moment("a", json!({ "sceneId": "green", "effectIds": ["fx"], "fadeMs": 500 }));
    r.start("a");
    // Puesto durante el fade: los effects del momento arrancan después y no lo sueltan.
    act(&mut r, json!({ "do": "color", "groupId": "pars", "color": "#0000ff" }), Some(true), None);
    r.run(700.0);
    assert_eq!(r.running(), json!(["fx"]));
    assert_eq!(r.playback()["heldColors"], json!({ "pars": "#0000ff" }));
    // A mano, sí.
    r.send(json!({ "type": "stopEffect", "id": "fx" }));
    r.send(json!({ "type": "startEffect", "id": "fx" }));
    assert_eq!(r.playback()["heldColors"], json!({}));
}

#[test]
fn the_phone_picks_a_color_for_everyone_and_sees_which_is_on() {
    let mut r = Rig::new();
    with_colors(&mut r);
    r.phone(json!({ "type": "color", "group": null, "color": "#ff0000" }));
    assert_eq!(p1_rgb(&r), [255, 0, 0]);
    let colors = r.show.phone_snapshot("running")["colors"].clone();
    assert_eq!(colors["choices"][1], json!({ "hex": "#0000ff", "name": "Azul" }));
    // La cabeza no toma color: no tiene fila.
    assert_eq!(colors["rows"], json!([{ "id": "pars", "name": "PAR", "held": "#ff0000" }]));

    let is_on = |r: &Rig, group: Value, color: Value| {
        r.show.is_active(&serde_json::from_value(json!({ "do": "color", "groupId": group, "color": color })).unwrap())
    };
    assert!(is_on(&r, json!(null), json!("#ff0000")));
    assert!(is_on(&r, json!("pars"), json!("#ff0000")));
    assert!(!is_on(&r, json!("pars"), json!(null)));

    // Un color que no existe no hace nada; sin color, se sueltan todos.
    r.phone(json!({ "type": "color", "group": "pars", "color": "#123456" }));
    assert_eq!(p1_rgb(&r), [255, 0, 0]);
    r.phone(json!({ "type": "color", "group": null, "color": null }));
    assert_eq!(r.playback()["heldColors"], json!({}));
    assert!(is_on(&r, json!(null), json!(null)));
}

#[test]
fn a_held_color_goes_away_with_its_color() {
    let mut r = Rig::new();
    with_colors(&mut r);
    act(&mut r, json!({ "do": "color", "groupId": "pars", "color": "#0000ff" }), Some(true), None);
    r.doc["colors"] = json!([]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback()["heldColors"], json!({}));
}

#[test]
fn two_lights_on_the_same_address_go_together() {
    let mut r = Rig::new();
    r.doc["effects"][0]["phaseOffsetDeg"] = json!(180);
    r.doc["instances"].as_array_mut().unwrap().insert(
        2,
        json!({ "id": "p1b", "definitionId": "par", "universe": 1, "address": 33, "group": "pars" }),
    );
    r.reset();
    r.send(json!({ "type": "startEffect", "id": "fx" }));
    r.run(200.0);
    // La gemela va igual que p1 y p2 sigue en contrafase, como si fueran dos.
    assert_eq!((r.live("p1", "red"), r.live("p1b", "red"), r.live("p2", "red")), (222, 222, 11));

    // Por el cable manda la primera.
    r.send(json!({ "type": "stopEffect", "id": "fx" }));
    r.set("p1b", "red", 77);
    assert_eq!(r.show.frame(1)[33], 222);
}

#[test]
fn the_phone_turns_effects_on_and_off() {
    let mut r = Rig::new();
    r.doc["effects"][0]["name"] = json!("PAR: ola roja");
    r.doc["effects"].as_array_mut().unwrap().push(json!({ "id": "suelto", "name": "Sin grupo", "groupId": null }));
    r.reset();
    r.phone(json!({ "type": "effect", "id": "fx" }));
    let effects = r.show.phone_snapshot("running")["effects"].clone();
    // Uno sin grupo no hace nada: no se ofrece.
    assert_eq!(effects, json!([{ "id": "fx", "name": "PAR: ola roja", "running": true }]));
    r.phone(json!({ "type": "effect", "id": "fx" }));
    assert_eq!(r.running(), json!([]));
}

// ----------------------------------------------------------------------
// Línea de tiempo
// ----------------------------------------------------------------------

/// Momentos a (rojo) y b (verde), y un vals de 10 s con sus marcas.
fn with_vals(r: &mut Rig, cues: Value) {
    with_colors(r);
    r.moment("a", json!({ "sceneId": "red" }));
    r.moment("b", json!({ "sceneId": "green", "fadeMs": 1000 }));
    let cues: Vec<Value> = cues
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
        .map(|(n, c)| {
            let mut cue = json!({ "id": format!("q{n}"), "lengthMs": null });
            for (k, v) in c.as_object().unwrap() {
                cue[k] = v.clone();
            }
            cue
        })
        .collect();
    r.doc["timelines"] = json!([{ "id": "vals", "name": "Vals", "durationMs": 10_000, "cues": cues }]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
}

fn play(r: &mut Rig, from: f64) {
    r.send(json!({ "type": "playTimeline", "id": "vals", "fromMs": from }));
}

#[test]
fn the_timeline_fires_each_cue_on_time() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([
        { "atMs": 0, "action": { "do": "moment", "id": "a" } },
        { "atMs": 2000, "action": { "do": "moment", "id": "b" } },
        { "atMs": 3000, "lengthMs": 1000, "action": { "do": "strobe" } },
    ]));
    play(&mut r, 0.0);
    r.run(100.0);
    assert_eq!(r.active(), json!("a"));
    r.run(1800.0);
    assert_eq!(r.active(), json!("a"));
    r.run(200.0);
    assert_eq!(r.active(), json!("b"));
    r.run(1000.0);
    assert_eq!(r.playback()["strobeActive"], json!(true));
    r.run(1000.0);
    assert_eq!(r.playback()["strobeActive"], json!(false));
}

#[test]
fn starting_halfway_leaves_the_lights_as_if_the_song_had_played_from_the_start() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([
        { "atMs": 0, "action": { "do": "moment", "id": "a" } },
        { "atMs": 1000, "action": { "do": "effect", "id": "fx" } },
        { "atMs": 2000, "action": { "do": "moment", "id": "b" } },
        { "atMs": 2200, "action": { "do": "color", "groupId": "pars", "color": "#ff0000" } },
        { "atMs": 3000, "lengthMs": 1000, "action": { "do": "strobe" } },
    ]));
    r.send(json!({ "type": "strobe", "on": true }));
    play(&mut r, 3500.0);
    r.run(20.0);
    assert_eq!(r.active(), json!("b"));
    // El momento b ya hizo su fade: arrancó hace 1,5 s.
    assert_eq!(r.live("p1", "green"), 250);
    // El effect lo soltó el momento b; el color vino después.
    assert_eq!(r.running(), json!([]));
    assert_eq!(r.playback()["heldColors"], json!({ "pars": "#ff0000" }));
    assert_eq!(r.playback()["strobeActive"], json!(true));
    r.run(600.0);
    assert_eq!(r.playback()["strobeActive"], json!(false));
}

#[test]
fn pausing_or_stopping_takes_off_the_strobe_and_going_on_puts_it_back() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([{ "atMs": 3000, "lengthMs": 2000, "action": { "do": "strobe" } }]));
    play(&mut r, 3200.0);
    r.run(20.0);
    assert_eq!(r.playback()["strobeActive"], json!(true));

    r.send(json!({ "type": "pauseTimeline" }));
    assert_eq!(r.playback()["strobeActive"], json!(false));
    let paused = r.playback()["timeline"]["pausedAt"].as_f64().unwrap();
    r.run(5000.0);
    assert_eq!(r.playback()["timeline"]["pausedAt"].as_f64().unwrap(), paused);

    play(&mut r, paused);
    r.run(20.0);
    assert_eq!(r.playback()["strobeActive"], json!(true));
    r.send(json!({ "type": "stopTimeline" }));
    assert_eq!(r.playback()["strobeActive"], json!(false));
    assert_eq!(r.playback()["timeline"], Value::Null);
}

#[test]
fn the_song_leads_if_it_runs_ahead_or_behind_the_lights_follow() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([{ "atMs": 1800, "action": { "do": "moment", "id": "b" } }]));
    play(&mut r, 0.0);
    r.run(1000.0);
    let started = r.playback()["timeline"]["startedAt"].clone();
    // Una diferencia chica no mueve nada.
    r.send(json!({ "type": "timelineSync", "id": "vals", "positionMs": 1020 }));
    assert_eq!(r.playback()["timeline"]["startedAt"], started);

    r.send(json!({ "type": "timelineSync", "id": "vals", "positionMs": 1500 }));
    r.run(260.0);
    assert_ne!(r.active(), json!("b"));
    r.run(60.0);
    assert_eq!(r.active(), json!("b"));
}

#[test]
fn while_the_song_plays_a_timed_moment_does_not_move_on_by_itself() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([{ "atMs": 0, "action": { "do": "moment", "id": "a" } }]));
    r.doc["moments"][0]["durationSec"] = json!(1);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    play(&mut r, 0.0);
    r.run(3000.0);
    assert_eq!(r.active(), json!("a"));
}

#[test]
fn at_the_end_of_the_song_it_stops_and_the_lights_stay() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([{ "atMs": 9000, "action": { "do": "moment", "id": "b" } }]));
    play(&mut r, 8000.0);
    r.run(2100.0);
    assert_eq!(r.playback()["timeline"], Value::Null);
    assert_eq!(r.active(), json!("b"));
    assert_eq!(r.live("p1", "green"), 250);
}

#[test]
fn deleting_the_timeline_that_plays_stops_it() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([]));
    play(&mut r, 0.0);
    r.doc["timelines"] = json!([]);
    r.send(json!({ "type": "doc", "doc": r.doc }));
    assert_eq!(r.playback()["timeline"], Value::Null);
}

#[test]
fn a_restarted_engine_does_not_repeat_what_already_played() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([
        { "atMs": 0, "action": { "do": "moment", "id": "a" } },
        { "atMs": 2000, "action": { "do": "moment", "id": "b" } },
    ]));
    play(&mut r, 0.0);
    r.run(1000.0);
    // A mano, a mitad de la canción.
    r.start("b");
    r.send(json!({ "type": "blackout", "on": true }));
    let saved = serde_json::to_string(&r.show.session()).unwrap();
    r.show = Show::new();
    r.show.restore(serde_json::from_str::<Session>(&saved).unwrap(), r.now).unwrap();
    r.run(500.0);
    // La marca de a (en 0) no se repite.
    assert_eq!((r.active(), r.playback()["blackoutActive"].clone()), (json!("b"), json!(true)));
    // La de b, que todavía no había sonado, sí: entrar a un momento quita el apagón.
    r.run(600.0);
    assert_eq!(r.playback()["blackoutActive"], json!(false));
}

#[test]
fn the_phone_and_the_buttons_start_and_stop_the_song() {
    let mut r = Rig::new();
    with_vals(&mut r, json!([{ "atMs": 12_000, "action": { "do": "moment", "id": "a" } }]));
    r.phone(json!({ "type": "timeline", "id": "vals", "play": true }));
    let s = r.show.phone_snapshot("running");
    assert_eq!(s["timelines"], json!([{ "id": "vals", "name": "Vals", "durationMs": 12_000.0 }]));
    assert_eq!(s["timeline"]["id"], json!("vals"));
    r.phone(json!({ "type": "timeline", "play": false }));
    assert_eq!(r.playback()["timeline"], Value::Null);

    let button = json!({ "type": "action", "action": { "do": "timeline", "id": "vals" }, "press": true });
    r.send(button.clone());
    assert_eq!(r.playback()["timeline"]["id"], json!("vals"));
    r.send(button);
    assert_eq!(r.playback()["timeline"], Value::Null);
}

// ----------------------------------------------------------------------
// Tap: el ritmo marcado a mano
// ----------------------------------------------------------------------

fn tap(r: &mut Rig) {
    r.send(json!({ "type": "tap" }));
}

/// Cuatro toques a 120 BPM (uno cada 500 ms).
fn tap_120(r: &mut Rig) {
    for _ in 0..3 {
        tap(r);
        r.run(500.0);
    }
    tap(r);
}

#[test]
fn tapping_sets_the_tempo_and_the_beat_effects_follow_it_without_music() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    tap_120(&mut r);
    assert_eq!(r.playback()["tapBpm"], json!(120.0));
    r.run(250.0); // medio golpe
    assert_eq!(r.live("p1", "red"), 100);
    r.run(500.0); // golpe y medio
    assert_eq!(r.live("p1", "red"), 100);
}

#[test]
fn one_tap_moves_the_beat_and_tapping_again_after_a_pause_changes_the_tempo() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    tap_120(&mut r);
    r.run(3130.0);
    // Un toque solo: mismo tempo, el golpe cae ahora.
    tap(&mut r);
    assert_eq!(r.playback()["tapBpm"], json!(120.0));
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100);

    r.run(3000.0);
    tap(&mut r);
    r.run(400.0);
    tap(&mut r);
    assert_eq!(r.playback()["tapBpm"], json!(150.0));
}

#[test]
fn with_a_tapped_tempo_the_bass_effects_beat_like_a_kick_and_letting_go_silences_them() {
    let mut r = Rig::new();
    music(&mut r, "bass");
    r.run(300.0);
    assert_eq!(r.live("p1", "red"), 0, "sin música ni ritmo, en su mínimo");
    tap_120(&mut r);
    r.run(20.0);
    assert!(r.live("p1", "red") > 150, "en el golpe");
    r.run(230.0);
    assert!(r.live("p1", "red") < 20, "entre golpes");
    r.run(270.0);
    assert!(r.live("p1", "red") > 150, "en el golpe siguiente");

    r.send(json!({ "type": "clearTap" }));
    assert_eq!(r.playback()["tapBpm"], Value::Null);
    r.run(20.0);
    assert_eq!(r.live("p1", "red"), 0);
}

#[test]
fn the_tapped_tempo_wins_over_what_the_microphone_hears() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    r.send(json!({ "type": "audio", "audio": { "levels": { "bass": 0, "mid": 0, "treble": 0 },
                                               "beat": { "beats": 8.25, "bpm": 60 } } }));
    r.run(20.0);
    tap_120(&mut r);
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100);
}

#[test]
fn a_tap_from_the_phone_counts_when_it_was_touched_not_when_it_arrived() {
    let mut r = Rig::new();
    r.phone(json!({ "type": "tap", "at": r.now - 300.0 }));
    r.run(700.0);
    // Llegó 700 ms después del anterior, pero se tocó 500 ms después.
    r.phone(json!({ "type": "tap", "at": r.now - 500.0 }));
    assert_eq!(r.playback()["tapBpm"], json!(120.0));
    r.phone(json!({ "type": "tapClear" }));
    assert_eq!(r.playback()["tapBpm"], Value::Null);
}

#[test]
fn a_button_taps_and_a_restarted_engine_keeps_the_tempo() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    let button = json!({ "type": "action", "action": { "do": "tap" }, "press": true });
    r.send(button.clone());
    r.run(500.0);
    r.send(button);
    assert_eq!(r.playback()["tapBpm"], json!(120.0));

    let saved = serde_json::to_string(&r.show.session()).unwrap();
    r.show = Show::new();
    r.show.restore(serde_json::from_str::<Session>(&saved).unwrap(), r.now).unwrap();
    assert_eq!(r.playback()["tapBpm"], json!(120.0));
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100);
}

// ----------------------------------------------------------------------
// Velocidad general
// ----------------------------------------------------------------------

#[test]
fn the_speed_hurries_or_slows_the_effects_without_jumps() {
    let mut r = Rig::new();
    music(&mut r, "clock"); // sierra de 0 a 200, una vuelta por segundo
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 46); // arrancó en el primer paso: 230 ms
    r.send(json!({ "type": "speed", "value": 200 }));
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 146, "media vuelta más, sin saltar");
    r.send(json!({ "type": "speed", "value": 50 }));
    r.run(400.0);
    assert_eq!(r.live("p1", "red"), 186);
}

#[test]
fn the_speed_also_hurries_the_chases() {
    let mut r = Rig::new();
    r.send(json!({ "type": "speed", "value": 200 }));
    r.send(json!({ "type": "playChase", "id": "c" }));
    // El fade de 1 s dura medio segundo.
    r.run(520.0);
    assert_eq!(r.playback()["chase"]["phase"], json!("hold"));
    assert_eq!(r.live("p1", "green"), 250);
}

#[test]
fn what_follows_the_music_keeps_its_tempo_at_any_speed() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    r.send(json!({ "type": "speed", "value": 400 }));
    r.send(json!({ "type": "audio", "audio": { "levels": { "bass": 0, "mid": 0, "treble": 0 },
                                               "beat": { "beats": 8.25, "bpm": 60 } } }));
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100);
}

#[test]
fn the_speed_comes_from_the_phone_and_from_a_fader_with_normal_in_the_middle() {
    let mut r = Rig::new();
    r.phone(json!({ "type": "speed", "value": 150 }));
    assert_eq!(r.playback()["speed"], json!(150.0));
    let fader = |r: &mut Rig, value: f64| {
        r.send(json!({ "type": "action", "action": { "do": "speed" }, "value": value }));
        r.playback()["speed"].as_f64().unwrap()
    };
    assert_eq!(fader(&mut r, 0.5), 100.0);
    assert_eq!(fader(&mut r, 1.0), 400.0);
    assert_eq!(fader(&mut r, 0.0), 25.0);
    r.phone(json!({ "type": "speed", "value": 9999 }));
    assert_eq!(r.playback()["speed"], json!(400.0));
}

// ----------------------------------------------------------------------
// Efectos especiales
// ----------------------------------------------------------------------

/// Una máquina de humo (canal 60) y una de chispas (canal 61), con su
/// efecto especial cada una.
fn with_specials(r: &mut Rig) {
    r.doc["definitions"].as_array_mut().unwrap().push(json!({ "id": "machine", "kind": "Smoke", "channels": [channel("out", 1, "OTHER", 0)] }));
    r.doc["instances"].as_array_mut().unwrap().extend([
        json!({ "id": "fog", "definitionId": "machine", "universe": 1, "address": 60 }),
        json!({ "id": "sparks", "definitionId": "machine", "universe": 1, "address": 61 }),
        json!({ "id": "haze", "definitionId": "machine", "universe": 1, "address": 62 }),
    ]);
    r.doc["specials"] = json!([
        { "id": "humo", "name": "Humo", "instanceId": "fog", "channelId": "out", "level": 255, "maxMs": 3000, "needsArm": false, "latch": false },
        { "id": "chispas", "name": "Chispas", "instanceId": "sparks", "channelId": "out", "level": 200, "maxMs": 2000, "needsArm": true, "latch": false },
        { "id": "haze", "name": "Haze", "instanceId": "haze", "channelId": "out", "level": 60, "maxMs": 600000, "needsArm": false, "latch": true },
    ]);
    r.reset();
}

fn press(r: &mut Rig, id: &str, on: bool) {
    r.send(json!({ "type": "action", "action": { "do": "special", "id": id }, "press": on }));
}

fn out(r: &Rig, address: usize) -> u8 {
    r.show.frame(1)[address - 1]
}

#[test]
fn a_special_stays_at_zero_unless_fired_and_only_while_pressed_up_to_its_maximum() {
    let mut r = Rig::new();
    with_specials(&mut r);
    // Una escena o un fader no lo prenden.
    r.set("fog", "out", 200);
    assert_eq!(out(&r, 60), 0);

    press(&mut r, "humo", true);
    r.run(1000.0);
    assert_eq!(out(&r, 60), 255);
    press(&mut r, "humo", false);
    assert_eq!(out(&r, 60), 0);

    // Aunque se siga apretando, no pasa de su máximo.
    press(&mut r, "humo", true);
    r.run(3100.0);
    assert_eq!(out(&r, 60), 0);
    assert_eq!(r.playback()["firing"], json!({}));
}

#[test]
fn sparks_need_arming_and_blackout_cuts_them() {
    let mut r = Rig::new();
    with_specials(&mut r);
    press(&mut r, "chispas", true);
    assert_eq!(out(&r, 61), 0, "sin armar no dispara");
    press(&mut r, "chispas", false);

    r.send(json!({ "type": "action", "action": { "do": "arm", "id": "chispas" }, "press": true }));
    assert!(r.playback()["armed"]["chispas"].is_number());
    press(&mut r, "chispas", true);
    assert_eq!(out(&r, 61), 200);

    r.send(json!({ "type": "blackout", "on": true }));
    assert_eq!(out(&r, 61), 0);
    r.send(json!({ "type": "blackout", "on": false }));
    assert_eq!(out(&r, 61), 0, "al volver no se reanuda");

    // El armado vence solo.
    r.run(5.0 * 60_000.0 + 100.0);
    assert_eq!(r.playback()["armed"], json!({}));
}

#[test]
fn haze_is_switched_on_with_one_tap_and_off_with_another() {
    let mut r = Rig::new();
    with_specials(&mut r);
    press(&mut r, "haze", true);
    press(&mut r, "haze", false);
    r.run(5000.0);
    assert_eq!(out(&r, 62), 60);
    press(&mut r, "haze", true);
    assert_eq!(out(&r, 62), 0);
}

#[test]
fn in_the_timeline_a_special_fires_only_if_it_was_armed() {
    let mut r = Rig::new();
    with_specials(&mut r);
    let specials = r.doc["specials"].clone();
    with_vals(&mut r, json!([{ "atMs": 1000, "lengthMs": 500, "action": { "do": "special", "id": "chispas" } }]));
    r.doc["specials"] = specials;
    r.send(json!({ "type": "doc", "doc": r.doc }));

    play(&mut r, 0.0);
    r.run(1200.0);
    assert_eq!(out(&r, 61), 0, "sin armar, la canción no lo dispara");

    r.send(json!({ "type": "arm", "id": "chispas", "on": true }));
    play(&mut r, 0.0);
    r.run(1200.0);
    assert_eq!(out(&r, 61), 200);
    r.run(400.0);
    assert_eq!(out(&r, 61), 0, "termina con la marca");
}

#[test]
fn the_phone_arms_and_fires() {
    let mut r = Rig::new();
    with_specials(&mut r);
    r.phone(json!({ "type": "arm", "id": "chispas" }));
    r.phone(json!({ "type": "special", "id": "chispas", "press": true }));
    assert_eq!(out(&r, 61), 200);
    let s = r.show.phone_snapshot("running");
    assert_eq!(s["specials"][1]["firing"], json!(true));
    assert!(s["specials"][1]["armedUntil"].is_number());
    r.phone(json!({ "type": "special", "id": "chispas", "press": false }));
    assert_eq!(out(&r, 61), 0);
}

// ----------------------------------------------------------------------
// VirtualDJ (OS2L)
// ----------------------------------------------------------------------

fn dj(r: &mut Rig, message: Value) {
    let now = r.now;
    r.show.os2l(&message, now);
}

#[test]
fn the_dj_beat_leads_the_effects_and_stops_counting_when_the_song_stops() {
    let mut r = Rig::new();
    music(&mut r, "beat");
    // Un golpe recién llegado: el 33 de la canción, a 120 BPM.
    dj(&mut r, json!({ "evt": "beat", "change": false, "pos": 33, "bpm": 120.0, "strength": 1.0 }));
    assert_eq!(r.playback()["djBpm"], json!(120.0));
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100, "medio golpe después");
    // Sin más golpes (pararon la canción) deja de mandar.
    r.run(3000.0);
    assert_eq!(r.playback()["djBpm"], Value::Null);
}

#[test]
fn the_dj_beat_also_drives_the_bass_effects_with_its_strength_and_tap_still_wins() {
    let mut r = Rig::new();
    music(&mut r, "bass");
    dj(&mut r, json!({ "evt": "beat", "change": false, "pos": 1, "bpm": 120.0, "strength": 50 }));
    r.run(20.0);
    let soft = r.live("p1", "red");
    assert!(soft > 70 && soft < 100, "a la mitad de fuerza: {soft}");

    music(&mut r, "beat");
    dj(&mut r, json!({ "evt": "beat", "change": false, "pos": 8, "bpm": 60.0 }));
    tap_120(&mut r);
    r.run(250.0);
    assert_eq!(r.live("p1", "red"), 100, "manda el TAP");
}

#[test]
fn dj_buttons_launch_what_has_that_name() {
    let mut r = Rig::new();
    with_specials(&mut r);
    r.moment("a", json!({ "name": "Hora loca" }));
    dj(&mut r, json!({ "evt": "btn", "name": "hora LOCA", "page": "", "state": "on" }));
    assert_eq!(r.active(), json!("a"));

    // El humo dispara mientras el botón del DJ está apretado.
    dj(&mut r, json!({ "evt": "btn", "name": "Humo", "state": "on" }));
    assert_eq!(out(&r, 60), 255);
    dj(&mut r, json!({ "evt": "btn", "name": "Humo", "state": "off" }));
    assert_eq!(out(&r, 60), 0);

    dj(&mut r, json!({ "evt": "btn", "name": "Estrobo", "state": "on" }));
    assert_eq!(r.playback()["strobeActive"], json!(true));
    dj(&mut r, json!({ "evt": "btn", "name": "Estrobo", "state": "off" }));
    assert_eq!(r.playback()["strobeActive"], json!(false));
    // Un nombre que no existe no hace nada.
    dj(&mut r, json!({ "evt": "btn", "name": "nada", "state": "on" }));
    dj(&mut r, json!({ "evt": "cmd", "id": 1, "param": 50 }));
}
