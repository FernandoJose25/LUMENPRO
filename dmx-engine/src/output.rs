//! Trait de salida DMX y drivers concretos.
//!
//! Un `DmxOutput` sabe hacer una sola cosa: recibir un frame de 512 bytes
//! y sacarlo por el medio físico que corresponda. Así el hilo del motor
//! (`engine.rs`) no sabe ni le importa si hay un Enttec real conectado o
//! un mock — eso es justo lo que permite desarrollar el resto de la app
//! (Scenes/Chases/Fixture Control) sin tener la consola física a mano,
//! que es tu paso 1 pendiente y bloquea la verificación con hardware real.

use crate::universe::CHANNEL_COUNT;
use std::io::Write;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DmxOutputError {
    #[error("error de puerto serie: {0}")]
    Serial(#[from] serialport::Error),
    #[error("error de E/S: {0}")]
    Io(#[from] std::io::Error),
}

pub trait DmxOutput: Send {
    /// Envía un frame completo. `frame` siempre tiene 512 bytes
    /// (índice 0 = canal DMX 1).
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError>;

    /// Nombre legible para logs/UI ("Enttec DMX USB PRO (COM5)", "Mock").
    fn name(&self) -> String;
}

// ---------------------------------------------------------------------
// Mock: no toca hardware. Sirve para desarrollar Scenes/Chases/Effects
// y probar el motor a frecuencia fija sin tener el Enttec ni la consola
// MAX 512 conectados.
// ---------------------------------------------------------------------

pub struct MockOutput {
    pub last_frame: [u8; CHANNEL_COUNT],
    pub frames_sent: u64,
}

impl MockOutput {
    pub fn new() -> Self {
        Self {
            last_frame: [0; CHANNEL_COUNT],
            frames_sent: 0,
        }
    }
}

impl Default for MockOutput {
    fn default() -> Self {
        Self::new()
    }
}

impl DmxOutput for MockOutput {
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
        self.last_frame = *frame;
        self.frames_sent += 1;
        Ok(())
    }

    fn name(&self) -> String {
        "Mock (sin hardware)".to_string()
    }
}

// ---------------------------------------------------------------------
// Enttec DMX USB PRO (widget label 6, "Output Only Send DMX Packet").
//
// Formato de paquete según la ENTTEC DMX USB PRO API Specification 1.44
// (de dominio público, documentada también por OLA / DMXKing):
//
//   [0x7E]  byte de inicio
//   [label] 0x06 = Output Only Send DMX Packet Request
//   [len_lsb][len_msb]  longitud de los datos que siguen, little-endian
//   [data...]           1 byte de start code (0x00) + hasta 512 canales
//   [0xE7]  byte de fin
//
// El propio widget maneja el timing DMX (break/MAB) internamente — por
// eso NO hace falta bit-banging FTDI como en un cable "Open DMX" genérico,
// solo escribir bytes por el puerto serie virtual que crea el driver FTDI.
//
// ⚠️ Sin el dispositivo físico no pude probar esto contra hardware real.
// El framing de paquete está tomado literalmente del spec público; lo que
// NO está verificado es tu unidad concreta (firmware/variante). Antes de
// confiar en esto en un show, probá primero con ENTTEC EMU o QLC+.
// ---------------------------------------------------------------------

const ENTTEC_START: u8 = 0x7E;
const ENTTEC_END: u8 = 0xE7;
const LABEL_OUTPUT_ONLY_SEND_DMX: u8 = 0x06;
const DMX_START_CODE: u8 = 0x00;

pub struct EnttecUsbProOutput {
    port: Box<dyn serialport::SerialPort>,
    port_name: String,
}

impl EnttecUsbProOutput {
    /// `port_name` ej. "COM5" en Windows o "/dev/ttyUSB0" en Linux.
    /// El baud rate es irrelevante para chips FTDI en este modo (según
    /// referencias de la comunidad OLA/Enttec), pero se fija un valor
    /// típico por compatibilidad con la pila de drivers.
    pub fn open(port_name: &str) -> Result<Self, DmxOutputError> {
        let port = serialport::new(port_name, 57_600)
            .timeout(Duration::from_millis(200))
            .open()?;
        Ok(Self {
            port,
            port_name: port_name.to_string(),
        })
    }

    /// Lista los puertos serie visibles para el sistema operativo.
    /// El Enttec suele aparecer como un adaptador FTDI ("USB Serial Port").
    pub fn list_ports() -> Result<Vec<String>, DmxOutputError> {
        Ok(serialport::available_ports()?
            .into_iter()
            .map(|p| p.port_name)
            .collect())
    }

    fn build_packet(frame: &[u8; CHANNEL_COUNT]) -> Vec<u8> {
        // data = start code + 512 canales
        let mut data = Vec::with_capacity(1 + CHANNEL_COUNT);
        data.push(DMX_START_CODE);
        data.extend_from_slice(frame);

        let len = data.len() as u16; // 513, cabe en u16
        let len_lsb = (len & 0xFF) as u8;
        let len_msb = (len >> 8) as u8;

        let mut packet = Vec::with_capacity(4 + data.len() + 1);
        packet.push(ENTTEC_START);
        packet.push(LABEL_OUTPUT_ONLY_SEND_DMX);
        packet.push(len_lsb);
        packet.push(len_msb);
        packet.extend_from_slice(&data);
        packet.push(ENTTEC_END);
        packet
    }
}

impl DmxOutput for EnttecUsbProOutput {
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
        let packet = Self::build_packet(frame);
        self.port.write_all(&packet)?;
        Ok(())
    }

    fn name(&self) -> String {
        format!("Enttec DMX USB PRO ({})", self.port_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_has_correct_framing_and_length() {
        let mut frame = [0u8; CHANNEL_COUNT];
        frame[0] = 255; // canal 1
        frame[6] = 128; // canal 7

        let packet = EnttecUsbProOutput::build_packet(&frame);

        assert_eq!(packet[0], ENTTEC_START);
        assert_eq!(packet[1], LABEL_OUTPUT_ONLY_SEND_DMX);
        // longitud de datos = 513 (start code + 512 canales) => 0x01, 0x02
        assert_eq!(packet[2], 0x01);
        assert_eq!(packet[3], 0x02);
        assert_eq!(packet[4], DMX_START_CODE); // start code
        assert_eq!(packet[5], 255); // canal 1
        assert_eq!(packet[11], 128); // canal 7
        assert_eq!(*packet.last().unwrap(), ENTTEC_END);
        assert_eq!(packet.len(), 4 + 513 + 1);
    }

    #[test]
    fn mock_output_records_frames() {
        let mut mock = MockOutput::new();
        let mut frame = [0u8; CHANNEL_COUNT];
        frame[5] = 200;
        mock.send_frame(&frame).unwrap();
        assert_eq!(mock.frames_sent, 1);
        assert_eq!(mock.last_frame[5], 200);
    }
}
