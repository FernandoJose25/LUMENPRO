//! El ritmo marcado a mano ("Tap"): se toca al ritmo de la canción y los
//! effects que siguen la música van con ese tempo, sin micrófono.

/// Más que esto entre dos toques: se empieza a contar de nuevo.
const RESTART_MS: f64 = 2000.0;
/// Se promedian los últimos toques: uno un poco antes o después no se nota.
const KEEP: usize = 8;
const MIN_BPM: f64 = 40.0;
const MAX_BPM: f64 = 240.0;
/// Qué tan rápido se apaga el golpe entre dos toques (como un bombo).
const PULSE_DECAY: f64 = 6.0;

#[derive(Debug, Clone, Default)]
pub struct Tap {
    taps: Vec<f64>,
    bpm: Option<f64>,
    /// Hora de un golpe y cuántos golpes iban en ese momento.
    anchor: f64,
    anchor_beats: f64,
}

impl Tap {
    /// Retoma un tempo (el motor se reinició): el golpe cae ahora.
    pub fn resume(bpm: f64, now: f64) -> Self {
        Self { taps: Vec::new(), bpm: Some(bpm), anchor: now, anchor_beats: 0.0 }
    }

    /// Un toque a la hora `at`. Cada toque cae en un golpe: con un solo
    /// toque, el tempo sigue igual y solo se acomoda el golpe.
    pub fn tap(&mut self, at: f64) {
        let last = self.taps.last().copied();
        if last.is_some_and(|l| at <= l) {
            return;
        }
        if last.is_none_or(|l| at - l > RESTART_MS) {
            self.taps.clear();
        }
        self.taps.push(at);
        if self.taps.len() > KEEP {
            self.taps.remove(0);
        }
        if self.taps.len() >= 2 {
            let bpm = 60_000.0 * (self.taps.len() - 1) as f64 / (at - self.taps[0]);
            if (MIN_BPM..=MAX_BPM).contains(&bpm) {
                self.bpm = Some(bpm);
            }
        }
        let beats = self.beats(at).map_or(0.0, f64::round);
        self.anchor = at;
        self.anchor_beats = beats;
    }

    pub fn bpm(&self) -> Option<f64> {
        self.bpm
    }

    /// Golpes contados, con decimales; None sin tempo todavía.
    pub fn beats(&self, now: f64) -> Option<f64> {
        let bpm = self.bpm?;
        Some(self.anchor_beats + (now - self.anchor) * bpm / 60_000.0)
    }

    /// 1 en cada golpe y se apaga hasta el siguiente: lo que haría un bombo.
    pub fn pulse(&self, now: f64) -> Option<f64> {
        let beats = self.beats(now)?;
        Some((-PULSE_DECAY * (beats - beats.floor())).exp())
    }
}
