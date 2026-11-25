//! De los valores en vivo a los canales DMX, tal como salen por el cable.

use crate::model::{Channel, ChannelType, ChannelValues, Curve, Definition, Doc, Instance};

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
}

fn goes_dark(channel: &Channel, definition: &Definition) -> bool {
    // Sin dimmer ni RGBW, cerrar el shutter es la única forma de apagarlo.
    channel.kind.is_light() || (channel.kind == ChannelType::Strobe && !definition.has(ChannelType::is_light))
}

/// La intensidad general baja el dimmer; sin dimmer, los colores.
fn follows_master(channel: &Channel, definition: &Definition) -> bool {
    channel.kind == ChannelType::Dimmer
        || (channel.kind.is_color() && !definition.has(|k| k == ChannelType::Dimmer))
}

/// Valor para el botón Estrobo, o `None` si no se sabe cuál es. En una cabeza
/// sin rango conocido no se adivina: podría caer en "cerrado". En un PAR lo
/// habitual es lento a rápido en todo el canal.
fn strobe_value(channel: &Channel, definition: &Definition) -> Option<f64> {
    match channel.presets.iter().find(|p| p.label == "Estrobo") {
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

fn effective(
    instance: &Instance,
    definition: &Definition,
    channel: &Channel,
    live: &ChannelValues,
    over: &Overlay,
) -> f64 {
    let mut value = live
        .get(&instance.id)
        .and_then(|channels| channels.get(&channel.id))
        .map_or(channel.default_value, |v| f64::from(*v));
    if over.strobe && channel.kind == ChannelType::Strobe {
        value = strobe_value(channel, definition).unwrap_or(value);
    }
    if follows_master(channel, definition) {
        value = value * over.master / 100.0;
    }
    if over.identify == Some(&instance.id) {
        match channel.kind {
            ChannelType::Mode => value = 0.0,
            ChannelType::Strobe => value = channel.default_value,
            kind if kind == ChannelType::Dimmer || kind.is_color() => value = 255.0,
            _ => {}
        }
    }
    if over.blackout && goes_dark(channel, definition) {
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
pub fn build(doc: &Doc, live: &ChannelValues, over: &Overlay, universe: i32) -> Frame {
    let mut frame = [0; CHANNELS];
    for (instance, definition) in doc.rig().filter(|(i, _)| i.universe == universe) {
        for channel in &definition.channels {
            let Ok(slot) = usize::try_from(instance.address.saturating_add(channel.index) - 2) else { continue };
            if slot >= CHANNELS {
                continue;
            }
            let value = effective(instance, definition, channel, live, over);
            let output =
                if is_inverted(instance, channel) { channel.dmx_min + channel.dmx_max - value } else { value };
            // floor(x + 0.5) y no round(): es lo que hace Math.round en la interfaz.
            frame[slot] = (output + 0.5).floor().clamp(0.0, 255.0) as u8;
        }
    }
    frame
}
