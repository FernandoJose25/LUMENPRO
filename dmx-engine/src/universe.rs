//! Estado en memoria de un universo DMX512 (512 canales, valores 0-255).
//!
//! `DmxUniverse` es la "fuente de verdad" que Scenes/Chases/Effects (Fase 4)
//! y el Fixture Control (Fase 3) escriben. El motor de salida (`engine.rs`)
//! lee este buffer periódicamente y lo envía por el driver activo.

use std::sync::{Arc, RwLock};

pub const CHANNEL_COUNT: usize = 512;

/// Buffer de 512 canales, compartible entre hilos (UI -> escritura,
/// hilo de salida -> lectura) sin bloquear la UI.
#[derive(Clone)]
pub struct DmxUniverse {
    channels: Arc<RwLock<[u8; CHANNEL_COUNT]>>,
}

impl DmxUniverse {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new([0u8; CHANNEL_COUNT])),
        }
    }

    /// `channel` es 1-indexado (canal DMX 1..=512), como en la consola física
    /// y como en `fixtureLibrary.ts` (campo `index`). Ignora valores fuera de rango
    /// en vez de entrar en pánico: un fixture mal configurado no debe tumbar el motor.
    pub fn set_channel(&self, channel: u16, value: u8) {
        if channel == 0 || channel as usize > CHANNEL_COUNT {
            return;
        }
        let mut buf = self.channels.write().expect("lock de universo envenenado");
        buf[(channel - 1) as usize] = value;
    }

    pub fn get_channel(&self, channel: u16) -> u8 {
        if channel == 0 || channel as usize > CHANNEL_COUNT {
            return 0;
        }
        let buf = self.channels.read().expect("lock de universo envenenado");
        buf[(channel - 1) as usize]
    }

    /// Escribe un bloque contiguo de canales, útil para volcar un fixture
    /// completo (address..address+channel_count) en una sola operación.
    pub fn set_block(&self, start_channel: u16, values: &[u8]) {
        let mut buf = self.channels.write().expect("lock de universo envenenado");
        for (i, v) in values.iter().enumerate() {
            let ch = start_channel as usize + i;
            if ch >= 1 && ch <= CHANNEL_COUNT {
                buf[ch - 1] = *v;
            }
        }
    }

    /// Copia instantánea de los 512 canales, en el orden que espera un
    /// paquete DMX (índice 0 = canal 1).
    pub fn snapshot(&self) -> [u8; CHANNEL_COUNT] {
        *self.channels.read().expect("lock de universo envenenado")
    }

    pub fn blackout(&self) {
        let mut buf = self.channels.write().expect("lock de universo envenenado");
        buf.fill(0);
    }
}

impl Default for DmxUniverse {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_channel_is_1_indexed() {
        let u = DmxUniverse::new();
        u.set_channel(1, 255);
        u.set_channel(512, 128);
        assert_eq!(u.get_channel(1), 255);
        assert_eq!(u.get_channel(512), 128);
        assert_eq!(u.get_channel(2), 0);
    }

    #[test]
    fn out_of_range_channel_is_ignored_not_panicking() {
        let u = DmxUniverse::new();
        u.set_channel(0, 200);
        u.set_channel(513, 200);
        assert_eq!(u.get_channel(0), 0);
    }

    #[test]
    fn set_block_writes_contiguous_range() {
        let u = DmxUniverse::new();
        u.set_block(33, &[10, 20, 30, 40, 50, 60, 70]); // ej. LPC007 PAR #1 en address 33
        assert_eq!(u.get_channel(33), 10);
        assert_eq!(u.get_channel(39), 70);
        assert_eq!(u.get_channel(40), 0);
    }

    #[test]
    fn blackout_zeroes_everything() {
        let u = DmxUniverse::new();
        u.set_channel(100, 255);
        u.blackout();
        assert_eq!(u.get_channel(100), 0);
    }
}
