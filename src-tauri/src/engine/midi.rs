//! Controladores MIDI: botones y faders físicos. Viven en el proceso del motor,
//! así que siguen andando con la ventana trabada o cerrada. Lo que hace cada
//! control está en el show (`Doc::controls`); acá solo se escucha, se reparte
//! y se encienden las luces de los botones.

use super::Engine;
use lumenpro_show::model::{Action, Control, ControlKind};
use lumenpro_show::Show;
use midir::{MidiInput, MidiInputConnection, MidiOutput, MidiOutputConnection};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const SCAN_EVERY: Duration = Duration::from_secs(2);
const LIGHTS_EVERY: Duration = Duration::from_millis(50);
const CLIENT: &str = "LUMEN PRO";

/// Un mensaje recibido, tal como se muestra al aprender un control.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Heard {
    pub device: String,
    pub kind: &'static str,
    pub channel: u8,
    pub number: u8,
    pub value: u8,
    /// Sube con cada mensaje: así la interfaz nota uno nuevo aunque sea igual.
    pub seq: u64,
}

#[derive(Default)]
pub struct Midi {
    inputs: Mutex<BTreeMap<String, MidiInputConnection<()>>>,
    outputs: Mutex<BTreeMap<String, MidiOutputConnection>>,
    last: Mutex<Option<Heard>>,
    /// Botones apretados, para que un CC usado como botón actúe una vez.
    held: Mutex<BTreeMap<(String, u8, u8, u8), bool>>,
    /// Lo que se le mandó a cada luz del controlador.
    lit: Mutex<BTreeMap<(String, u8, u8, u8), bool>>,
}

/// (es nota, canal, número, valor). Note off es una nota con valor 0.
fn parse(bytes: &[u8]) -> Option<(ControlKind, u8, u8, u8)> {
    let &[status, number, value] = bytes.get(..3)? else { return None };
    let channel = status & 0x0F;
    match status & 0xF0 {
        0x90 => Some((ControlKind::Note, channel, number, value)),
        0x80 => Some((ControlKind::Note, channel, number, 0)),
        0xB0 => Some((ControlKind::Cc, channel, number, value)),
        _ => None,
    }
}

fn kind_code(kind: ControlKind) -> u8 {
    match kind {
        ControlKind::Note => 0,
        ControlKind::Cc => 1,
    }
}

fn matches(control: &Control, device: &str, kind: ControlKind, channel: u8, number: u8) -> bool {
    (control.device.is_empty() || control.device == device)
        && control.kind == kind
        && control.channel == i32::from(channel)
        && control.number == i32::from(number)
}

/// Luz encendida o apagada de cada control que la tiene, según el show.
pub fn lights(show: &Show) -> Vec<(&Control, bool)> {
    show.doc()
        .controls
        .iter()
        .filter(|c| !c.action.is_fader() && c.action != Action::Nothing)
        .map(|c| (c, show.is_active(&c.action)))
        .collect()
}

impl Midi {
    pub fn last(&self) -> Option<Heard> {
        self.last.lock().unwrap().clone()
    }

    pub fn devices(&self) -> Vec<String> {
        self.inputs.lock().unwrap().keys().cloned().collect()
    }
}

impl Engine {
    /// Un mensaje de un controlador.
    pub fn midi_event(&self, device: &str, bytes: &[u8]) {
        let Some((kind, channel, number, value)) = parse(bytes) else { return };
        {
            let mut last = self.midi.last.lock().unwrap();
            let seq = last.as_ref().map_or(1, |l| l.seq + 1);
            let kind = if kind == ControlKind::Note { "note" } else { "cc" };
            *last = Some(Heard { device: device.into(), kind, channel, number, value, seq });
        }
        let pressed = value >= 64 || (kind == ControlKind::Note && value > 0);
        let key = (device.to_string(), kind_code(kind), channel, number);
        let was = self.midi.held.lock().unwrap().insert(key, pressed).unwrap_or(false);

        let now = self.clock.now();
        let mut show = self.show.lock().unwrap();
        let actions: Vec<Action> = show
            .doc()
            .controls
            .iter()
            .filter(|c| matches(c, device, kind, channel, number))
            .map(|c| c.action.clone())
            .collect();
        for action in actions {
            if action.is_fader() {
                show.act(&action, None, Some(f64::from(value) / 127.0), now);
            } else if pressed != was {
                show.act(&action, Some(pressed), None, now);
            }
        }
        drop(show);
        self.changed.notify_all();
    }
}

/// Busca controladores enchufados y enciende las luces de sus botones.
pub(super) fn run(engine: Arc<Engine>) {
    thread::spawn(move || {
        let mut scanned: Option<Instant> = None;
        loop {
            if scanned.is_none_or(|at| at.elapsed() >= SCAN_EVERY) {
                scanned = Some(Instant::now());
                scan(&engine);
            }
            update_lights(&engine);
            thread::sleep(LIGHTS_EVERY);
        }
    });
}

fn scan(engine: &Arc<Engine>) {
    let Ok(probe) = MidiInput::new(CLIENT) else { return };
    let ports: Vec<_> = probe.ports().into_iter().filter_map(|p| Some((probe.port_name(&p).ok()?, p))).collect();
    {
        let mut inputs = engine.midi.inputs.lock().unwrap();
        // Los que se desenchufaron.
        inputs.retain(|name, _| ports.iter().any(|(n, _)| n == name));
        for (name, port) in &ports {
            if inputs.contains_key(name) {
                continue;
            }
            let (weak, device) = (Arc::downgrade(engine), name.clone());
            let Ok(input) = MidiInput::new(CLIENT) else { continue };
            let connected = input.connect(
                port,
                "lumenpro",
                move |_, bytes, _| {
                    if let Some(engine) = weak.upgrade() {
                        engine.midi_event(&device, bytes);
                    }
                },
                (),
            );
            if let Ok(connection) = connected {
                inputs.insert(name.clone(), connection);
            }
        }
    }

    let Ok(probe) = MidiOutput::new(CLIENT) else { return };
    let ports: Vec<_> = probe.ports().into_iter().filter_map(|p| Some((probe.port_name(&p).ok()?, p))).collect();
    let mut outputs = engine.midi.outputs.lock().unwrap();
    outputs.retain(|name, _| ports.iter().any(|(n, _)| n == name));
    for (name, port) in ports {
        if outputs.contains_key(&name) {
            continue;
        }
        let Ok(output) = MidiOutput::new(CLIENT) else { continue };
        if let Ok(connection) = output.connect(&port, "lumenpro") {
            outputs.insert(name, connection);
            // Uno nuevo: hay que mandarle todo otra vez.
            engine.midi.lit.lock().unwrap().clear();
        }
    }
}

fn update_lights(engine: &Engine) {
    let wanted: Vec<(String, u8, u8, u8, bool)> = {
        let show = engine.show.lock().unwrap();
        lights(&show)
            .into_iter()
            .map(|(c, on)| (c.device.clone(), kind_code(c.kind), c.channel as u8, c.number as u8, on))
            .collect()
    };
    let mut outputs = engine.midi.outputs.lock().unwrap();
    let mut lit = engine.midi.lit.lock().unwrap();
    for (device, kind, channel, number, on) in wanted {
        let key = (device.clone(), kind, channel, number);
        if lit.get(&key) == Some(&on) {
            continue;
        }
        let status = if kind == 0 { 0x90 } else { 0xB0 } | (channel & 0x0F);
        let message = [status, number & 0x7F, if on { 127 } else { 0 }];
        for (name, output) in outputs.iter_mut() {
            if device.is_empty() || *name == device {
                let _ = output.send(&message);
            }
        }
        lit.insert(key, on);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_on_off_and_cc_are_understood_and_the_rest_ignored() {
        assert_eq!(parse(&[0x91, 36, 100]), Some((ControlKind::Note, 1, 36, 100)));
        assert_eq!(parse(&[0x81, 36, 64]), Some((ControlKind::Note, 1, 36, 0)));
        assert_eq!(parse(&[0xB0, 7, 127]), Some((ControlKind::Cc, 0, 7, 127)));
        assert_eq!(parse(&[0xE0, 0, 64]), None); // pitch bend
        assert_eq!(parse(&[0xF8]), None); // reloj
        assert_eq!(parse(&[]), None);
    }
}
