//! De los valores en vivo a los canales DMX, tal como salen por el cable.

use crate::model::{Channel, ChannelType, ChannelValues, Curve, Definition, Doc, Instance, Role};

pub const CHANNELS: usize = 512;
pub type Frame = [u8; CHANNELS];

/// Lo que se aplica encima de los valores sin tocarlos: al quitarlo todo
/// vuelve exactamente como estaba.
pub struct Overlay<'a> {
    pub blackout: bool,
    /// Intensidad general, 0–100.
    pub master: f64,
    pub strobe: bool,
    /// Fixture encendido a pleno para reconocerlo.
    pub identify: Option<&'a str>,
    /// Los colores fijos de cada luz: le ganan al momento y a los effects.
    pub held: &'a ChannelValues,
}

/// Valor para el botón Estrobo, o `None` si no se sabe cuál es. En una cabeza
/// sin rango conocido no se adivina: podría caer en "cerrado". En un PAR lo
/// habitual es lento a rápido en todo el canal.
fn strobe_value(channel: &Channel, definition: &Definition) -> Option<f64> {
    let strobe = |p: &&crate::model::Preset| p.label == "Estrobo" || p.kind.as_deref() == Some("strobe");
    match channel.presets.iter().find(strobe) {
        Some(range) => Some(range.dmx_from + (range.dmx_to - range.dmx_from) * 0.75),
        None if definition.has(|k| k == ChannelType::Pan) => None,
        None => Some(200.0),
    }
}

fn apply_curve(channel: &Channel, value: f64) -> f64 {
    let range = channel.dmx_max - channel.dmx_min;
    if channel.curve == Curve::Linear || !channel.kind.accepts_curve() || range <= 0.0 {
        return value;
    }
    let t = ((value - channel.dmx_min) / range).clamp(0.0, 1.0);
    let curved = if channel.curve == Curve::Log { t * t } else { t * t * (3.0 - 2.0 * t) };
    channel.dmx_min + range * curved
}

/// Valor en vivo de un canal, sin intensidad ni nada encima. Le ganan el color
/// fijo y después las figuras (`moving`) a lo que haya debajo.
fn live_value(instance: &Instance, channel: &Channel, live: &ChannelValues, moving: &ChannelValues, held: &ChannelValues) -> f64 {
    let read = |values: &ChannelValues| values.get(&instance.id).and_then(|c| c.get(&channel.id)).copied();
    read(held).or_else(|| read(moving)).or_else(|| read(live)).map_or(channel.default_value, f64::from)
}

/// Lo que vale con intensidad, estrobo, identificar, Blackout y curva.
fn effective(
    instance: &Instance,
    definition: &Definition,
    (channel, role): (&Channel, &Role),
    value: f64,
    over: &Overlay,
) -> f64 {
    let mut value = value;
    if over.strobe && channel.kind == ChannelType::Strobe {
        value = strobe_value(channel, definition).unwrap_or(value);
    }
    if role.follows_master {
        value = value * over.master / 100.0;
    }
    if over.identify == Some(&instance.id) && definition.gives_light() {
        match channel.kind {
            ChannelType::Mode | ChannelType::Color => value = 0.0,
            ChannelType::Strobe => value = channel.default_value,
            kind if kind == ChannelType::Dimmer || definition.emits(kind) => value = 255.0,
            _ => {}
        }
    }
    if over.blackout && role.goes_dark {
        return 0.0;
    }
    apply_curve(channel, value)
}

fn is_inverted(instance: &Instance, channel: &Channel) -> bool {
    use ChannelType::*;
    let by_mount = match channel.kind {
        Pan | PanFine => instance.pan_invert,
        Tilt | TiltFine => instance.tilt_invert,
        _ => false,
    };
    channel.invert != by_mount
}

/// Índice 0 = canal DMX 1.
pub fn build(doc: &Doc, live: &ChannelValues, moving: &ChannelValues, over: &Overlay, universe: i32) -> Frame {
    let mut frame = [0; CHANNELS];
    let mut put = |address: i32, channel: &Channel, value: u8| {
        if let Ok(slot) = usize::try_from(address.saturating_add(channel.index) - 2) {
            if let Some(out) = frame.get_mut(slot) {
                *out = value;
            }
        }
    };
    let rig: Vec<_> = doc.rig().filter(|(i, _)| i.universe == universe).collect();
    for (n, &(instance, definition)) in rig.iter().enumerate() {
        // De dos luces que van juntas, manda la primera.
        if rig[..n].iter().any(|(other, _)| other.twin_of(instance)) {
            continue;
        }
        let held = over.held;
        // Los finos salen junto con el canal que completan.
        for (channel, role) in definition.channels.iter().zip(&definition.roles).filter(|(_, r)| !r.is_fine) {
            let value = live_value(instance, channel, live, moving, held);
            let inverted = is_inverted(instance, channel);
            // floor(x + 0.5) y no round(): es lo que hace Math.round en la interfaz.
            match role.fine.map(|i| &definition.channels[i]) {
                None => {
                    let value = effective(instance, definition, (channel, role), value, over);
                    let output = if inverted { channel.dmx_min + channel.dmx_max - value } else { value };
                    put(instance.address, channel, (output + 0.5).floor().clamp(0.0, 255.0) as u8);
                }
                Some(fine_channel) => {
                    let value = value + live_value(instance, fine_channel, live, moving, held) / 256.0;
                    let value = effective(instance, definition, (channel, role), value, over) * 256.0;
                    let top = (channel.dmx_min + channel.dmx_max) * 256.0 + 255.0;
                    let output = if inverted { top - value } else { value };
                    let output = (output + 0.5).floor().clamp(0.0, 65535.0) as u32;
                    put(instance.address, channel, (output >> 8) as u8);
                    put(instance.address, fine_channel, (output & 255) as u8);
                }
            }
        }
    }
    frame
}
