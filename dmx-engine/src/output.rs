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
use std::thread;
use std::time::{Duration, Instant};
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
// Puertos serie visibles para el sistema operativo.
// ---------------------------------------------------------------------

/// Chip USB-serie detrás del puerto. Importa porque un cable "Open DMX"
/// depende del BREAK que genera el chip: con FTDI es estable, con CH340
/// suele parpadear.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortChip {
    Ftdi,
    Ch340,
    Other,
}

impl PortChip {
    fn from_vid(vid: u16) -> Self {
        match vid {
            0x0403 => Self::Ftdi,
            0x1A86 => Self::Ch340,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PortInfo {
    /// "COM3" en Windows, "/dev/ttyUSB0" en Linux.
    pub name: String,
    pub chip: PortChip,
    /// Texto del sistema ("USB Serial Port (COM3)"), vacío si no lo informa.
    pub description: String,
}

pub fn list_ports() -> Result<Vec<PortInfo>, DmxOutputError> {
    Ok(serialport::available_ports()?
        .into_iter()
        .map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(usb) => PortInfo {
                name: p.port_name,
                chip: PortChip::from_vid(usb.vid),
                description: usb.product.unwrap_or_default(),
            },
            _ => PortInfo {
                name: p.port_name,
                chip: PortChip::Other,
                description: String::new(),
            },
        })
        .collect())
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

// ---------------------------------------------------------------------
// Open DMX: cable FTDI (FT232R) + RS485 sin microcontrolador, el adaptador
// barato con XLR hembra de 3 pines. A diferencia del Enttec PRO, acá el
// timing DMX lo marca la PC: BREAK por software y 513 slots a 250 kbaudios.
//
// ⚠️ Sin probar contra hardware real todavía (ver PASOS-PENDIENTES.md).
// ---------------------------------------------------------------------

const DMX_BAUD: u32 = 250_000;
/// 513 slots x 11 bits (start + 8 datos + 2 stop) x 4 µs = 22 572 µs.
const FRAME_TIME: Duration = Duration::from_micros(22_572);
/// Holgura para la latencia USB antes de poder bajar la línea otra vez.
const USB_MARGIN: Duration = Duration::from_micros(2_500);
/// Lo que tarda en vaciarse la FIFO de transmisión del FT232R (128 bytes).
const FIFO_DRAIN: Duration = Duration::from_millis(6);
/// Mínimo del estándar: 92 µs. Un BREAK más largo es válido.
const BREAK_TIME: Duration = Duration::from_micros(200);

pub struct OpenDmxOutput {
    port: Box<dyn serialport::SerialPort>,
    port_name: String,
    /// Hasta cuándo puede seguir saliendo el frame anterior por el cable.
    /// Un BREAK antes de eso lo corta a la mitad y las luces parpadean.
    line_busy_until: Instant,
}

impl OpenDmxOutput {
    pub fn open(port_name: &str) -> Result<Self, DmxOutputError> {
        let mut port = serialport::new(port_name, DMX_BAUD)
            .data_bits(serialport::DataBits::Eight)
            .parity(serialport::Parity::None)
            .stop_bits(serialport::StopBits::Two)
            .flow_control(serialport::FlowControl::None)
            .timeout(Duration::from_millis(200))
            .open()?;
        // Los Enttec Open DMX y clones usan RTS para habilitar el transmisor
        // RS485: RTS bajo = transmitir (mismo criterio que QLC+). Los cables
        // con TXDEN automático lo ignoran.
        port.write_request_to_send(false)?;
        Ok(Self {
            port,
            port_name: port_name.to_string(),
            line_busy_until: Instant::now(),
        })
    }

    fn build_slots(frame: &[u8; CHANNEL_COUNT]) -> [u8; CHANNEL_COUNT + 1] {
        let mut slots = [DMX_START_CODE; CHANNEL_COUNT + 1];
        slots[1..].copy_from_slice(frame);
        slots
    }

    /// El driver puede devolver el control al encolar los bytes o recién al
    /// enviarlos: se toma el peor de los dos casos.
    fn busy_until(write_started: Instant, write_returned: Instant) -> Instant {
        (write_started + FRAME_TIME + USB_MARGIN).max(write_returned + FIFO_DRAIN)
    }
}

impl DmxOutput for OpenDmxOutput {
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
        thread::sleep(self.line_busy_until.saturating_duration_since(Instant::now()));

        self.port.set_break()?;
        thread::sleep(BREAK_TIME);
        // El MAB (mínimo 12 µs) queda cubierto por el propio viaje USB entre
        // soltar el BREAK y que llegue el primer byte al chip.
        self.port.clear_break()?;

        let write_started = Instant::now();
        self.port.write_all(&Self::build_slots(frame))?;
        self.line_busy_until = Self::busy_until(write_started, Instant::now());
        Ok(())
    }

    fn name(&self) -> String {
        format!("Cable FTDI ({})", self.port_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_dmx_slots_start_with_zero_start_code() {
        let mut frame = [0u8; CHANNEL_COUNT];
        frame[0] = 255; // canal 1
        frame[511] = 77; // canal 512
        let slots = OpenDmxOutput::build_slots(&frame);
        assert_eq!(slots.len(), 513);
        assert_eq!(slots[0], DMX_START_CODE);
        assert_eq!(slots[1], 255);
        assert_eq!(slots[512], 77);
    }

    #[test]
    fn open_dmx_never_breaks_before_the_frame_is_out() {
        let start = Instant::now();
        // El driver encola y vuelve al instante: hay que esperar el frame entero.
        let queued = OpenDmxOutput::busy_until(start, start);
        assert!(queued >= start + FRAME_TIME);
        // El driver vuelve cuando ya transmitió: falta vaciar la FIFO del chip.
        let returned = start + FRAME_TIME + USB_MARGIN;
        let sent = OpenDmxOutput::busy_until(start, returned);
        assert!(sent >= returned + FIFO_DRAIN);
        // Y el peor caso entra en un período de 30 fps.
        assert!(sent + BREAK_TIME < start + Duration::from_micros(33_333));
    }

    #[test]
    fn opening_a_missing_port_fails_instead_of_panicking() {
        assert!(OpenDmxOutput::open("COM_QUE_NO_EXISTE").is_err());
    }

    #[test]
    fn port_chip_is_detected_by_usb_vendor_id() {
        assert_eq!(PortChip::from_vid(0x0403), PortChip::Ftdi);
        assert_eq!(PortChip::from_vid(0x1A86), PortChip::Ch340);
        assert_eq!(PortChip::from_vid(0x2341), PortChip::Other);
    }

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
