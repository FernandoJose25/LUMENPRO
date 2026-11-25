//! Salidas por red: Art-Net 4 y sACN (ANSI E1.31), y la búsqueda de nodos
//! Art-Net.

use crate::output::{DmxOutput, DmxOutputError};
use crate::universe::CHANNEL_COUNT;
use if_addrs::IfAddr;
use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use std::collections::BTreeMap;
use std::io;
use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};
use std::time::{Duration, Instant};

pub const ARTNET_PORT: u16 = 6454;
pub const SACN_PORT: u16 = 5568;
/// Cada cuánto se revisa si hay una red nueva (un router que se encendió tarde).
const INTERFACES_EVERY: Duration = Duration::from_secs(5);

/// Las redes de esta PC: su dirección y la de difusión.
fn interfaces() -> Vec<(Ipv4Addr, Ipv4Addr)> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.addr {
            IfAddr::V4(v4) if !v4.ip.is_link_local() => {
                let broadcast = v4.broadcast.unwrap_or(Ipv4Addr::from(u32::from(v4.ip) | !u32::from(v4.netmask)));
                Some((v4.ip, broadcast))
            }
            _ => None,
        })
        .collect()
}

/// Carga lo que hace falta para salir por la red.
pub fn warm_up() {
    let _ = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0));
    let _ = interfaces();
}

fn udp() -> io::Result<Socket> {
    Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
}

// ---------------------------------------------------------------------
// Art-Net
// ---------------------------------------------------------------------

const ARTNET_ID: &[u8; 8] = b"Art-Net\0";
const OP_DMX: u16 = 0x5000;
const OP_POLL: u16 = 0x2000;
const OP_POLL_REPLY: u16 = 0x2100;
const PROTOCOL: u8 = 14;

/// `universe` es la "Port-Address" de 15 bits: Net, Sub-Net y Universe juntos.
pub fn artnet_packet(universe: u16, sequence: u8, frame: &[u8; CHANNEL_COUNT]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(18 + CHANNEL_COUNT);
    packet.extend_from_slice(ARTNET_ID);
    packet.extend_from_slice(&OP_DMX.to_le_bytes());
    packet.extend_from_slice(&[0, PROTOCOL, sequence, 0]);
    packet.extend_from_slice(&(universe & 0x7FFF).to_le_bytes());
    packet.extend_from_slice(&(CHANNEL_COUNT as u16).to_be_bytes());
    packet.extend_from_slice(frame);
    packet
}

/// Ni Art-Net ni sACN quieren el 0 en el primer paquete: Art-Net lo usa para
/// "sin orden".
fn next_sequence(sequence: u8) -> u8 {
    if sequence == 255 {
        1
    } else {
        sequence + 1
    }
}

pub struct ArtNetOutput {
    socket: UdpSocket,
    /// `None` = a toda la red.
    target: Option<SocketAddrV4>,
    port: u16,
    universe: u16,
    sequence: u8,
    broadcasts: Vec<Ipv4Addr>,
    looked_at: Instant,
}

impl ArtNetOutput {
    /// `host` vacío = difusión.
    pub fn open(host: &str, universe: u16) -> Result<Self, DmxOutputError> {
        Self::with_port(host, universe, ARTNET_PORT)
    }

    fn with_port(host: &str, universe: u16, port: u16) -> Result<Self, DmxOutputError> {
        let target = match host.trim() {
            "" => None,
            host => Some(SocketAddrV4::new(
                host.parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, format!("{host} no es una dirección IP"))
                })?,
                port,
            )),
        };
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?;
        socket.set_broadcast(true)?;
        Ok(Self {
            socket,
            target,
            port,
            universe,
            sequence: 0,
            broadcasts: interfaces().into_iter().map(|(_, b)| b).collect(),
            looked_at: Instant::now(),
        })
    }
}

impl DmxOutput for ArtNetOutput {
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
        self.sequence = next_sequence(self.sequence);
        let packet = artnet_packet(self.universe, self.sequence, frame);
        if let Some(target) = self.target {
            self.socket.send_to(&packet, target)?;
            return Ok(());
        }
        if self.looked_at.elapsed() >= INTERFACES_EVERY {
            self.broadcasts = interfaces().into_iter().map(|(_, b)| b).collect();
            self.looked_at = Instant::now();
        }
        // Una red caída no es un corte si otra funciona.
        let mut result = Err(io::Error::new(io::ErrorKind::NotConnected, "Esta PC no está en ninguna red"));
        for broadcast in &self.broadcasts {
            let sent = self.socket.send_to(&packet, (*broadcast, self.port));
            if sent.is_ok() || result.is_err() {
                result = sent;
            }
        }
        result?;
        Ok(())
    }

    fn name(&self) -> String {
        match self.target {
            Some(target) => format!("Art-Net {} ({})", self.universe, target.ip()),
            None => format!("Art-Net {} (toda la red)", self.universe),
        }
    }
}

/// Un nodo Art-Net que contestó.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtNetNode {
    pub ip: Ipv4Addr,
    pub short_name: String,
    pub long_name: String,
    /// Port-Address de cada salida DMX.
    pub universes: Vec<u16>,
}

fn poll_packet() -> Vec<u8> {
    let mut packet = ARTNET_ID.to_vec();
    packet.extend_from_slice(&OP_POLL.to_le_bytes());
    // Contestar solo cuando se pregunta; sin diagnósticos.
    packet.extend_from_slice(&[0, PROTOCOL, 0, 0]);
    packet
}

fn parse_poll_reply(packet: &[u8]) -> Option<ArtNetNode> {
    if packet.len() < 207 || &packet[..8] != ARTNET_ID || packet[8..10] != OP_POLL_REPLY.to_le_bytes() {
        return None;
    }
    let text = |range: std::ops::Range<usize>| {
        let bytes = &packet[range];
        let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).trim().to_string()
    };
    let (net, sub_net) = (u16::from(packet[18] & 0x7F), u16::from(packet[19] & 0x0F));
    let ports = usize::from(packet[173]).min(4);
    let universes = (0..ports)
        .filter(|i| packet[174 + i] & 0x80 != 0) // saca DMX
        .map(|i| net << 8 | sub_net << 4 | u16::from(packet[190 + i] & 0x0F))
        .collect();
    Some(ArtNetNode {
        ip: Ipv4Addr::new(packet[10], packet[11], packet[12], packet[13]),
        short_name: text(26..44),
        long_name: text(44..108),
        universes,
    })
}

/// Pregunta en todas las redes y junta las respuestas durante `wait`.
pub fn discover_artnet(wait: Duration) -> Result<Vec<ArtNetNode>, DmxOutputError> {
    let socket = udp()?;
    // Puede haber otro programa Art-Net abierto: el puerto se comparte.
    socket.set_reuse_address(true)?;
    socket.set_broadcast(true)?;
    socket.bind(&SockAddr::from(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, ARTNET_PORT)))?;
    let listener: UdpSocket = socket.into();
    listener.set_read_timeout(Some(Duration::from_millis(100)))?;
    for (_, broadcast) in interfaces() {
        let _ = listener.send_to(&poll_packet(), (broadcast, ARTNET_PORT));
    }

    let mut nodes: BTreeMap<Ipv4Addr, ArtNetNode> = BTreeMap::new();
    let limit = Instant::now() + wait;
    let mut buffer = [0u8; 1024];
    while Instant::now() < limit {
        let Ok((len, _)) = listener.recv_from(&mut buffer) else { continue };
        let Some(node) = parse_poll_reply(&buffer[..len]) else { continue };
        // Los nodos de más de cuatro puertos contestan varias veces.
        match nodes.get_mut(&node.ip) {
            Some(known) => {
                for universe in node.universes {
                    if !known.universes.contains(&universe) {
                        known.universes.push(universe);
                    }
                }
            }
            None => {
                nodes.insert(node.ip, node);
            }
        }
    }
    Ok(nodes.into_values().collect())
}

// ---------------------------------------------------------------------
// sACN (E1.31)
// ---------------------------------------------------------------------

const SOURCE_NAME: &str = "LUMEN PRO";
const PRIORITY: u8 = 100;
const STREAM_TERMINATED: u8 = 0x40;

/// Identifica a esta PC ante los receptores. Fijo: si cambiara en cada
/// arranque, por unos segundos creerían que hay dos consolas a la vez.
fn component_id() -> [u8; 16] {
    let host = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let mut id = [0u8; 16];
    for (half, seed) in id.chunks_mut(8).zip([0xcbf2_9ce4_8422_2325u64, 0x9e37_79b9_7f4a_7c15]) {
        let hash = host.bytes().fold(seed, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3));
        half.copy_from_slice(&hash.to_be_bytes());
    }
    // Forma de UUID válida.
    id[6] = id[6] & 0x0F | 0x50;
    id[8] = id[8] & 0x3F | 0x80;
    id
}

pub fn sacn_packet(
    universe: u16,
    sequence: u8,
    options: u8,
    cid: &[u8; 16],
    frame: &[u8; CHANNEL_COUNT],
) -> Vec<u8> {
    const SIZE: usize = 638;
    let mut p = Vec::with_capacity(SIZE);
    // Cada capa dice cuánto queda desde ahí hasta el final.
    let length = |from: usize| (0x7000 | (SIZE - from) as u16).to_be_bytes();

    // Raíz
    p.extend_from_slice(&[0x00, 0x10, 0x00, 0x00]);
    p.extend_from_slice(b"ASC-E1.17\0\0\0");
    p.extend_from_slice(&length(16));
    p.extend_from_slice(&4u32.to_be_bytes());
    p.extend_from_slice(cid);
    // Encuadre
    p.extend_from_slice(&length(38));
    p.extend_from_slice(&2u32.to_be_bytes());
    let mut name = [0u8; 64];
    name[..SOURCE_NAME.len()].copy_from_slice(SOURCE_NAME.as_bytes());
    p.extend_from_slice(&name);
    p.extend_from_slice(&[PRIORITY, 0, 0, sequence, options]);
    p.extend_from_slice(&universe.to_be_bytes());
    // DMP
    p.extend_from_slice(&length(115));
    p.extend_from_slice(&[0x02, 0xA1, 0x00, 0x00, 0x00, 0x01]);
    p.extend_from_slice(&(CHANNEL_COUNT as u16 + 1).to_be_bytes());
    p.push(0); // start code
    p.extend_from_slice(frame);
    p
}

pub fn sacn_group(universe: u16) -> Ipv4Addr {
    let [high, low] = universe.to_be_bytes();
    Ipv4Addr::new(239, 255, high, low)
}

pub struct SacnOutput {
    universe: u16,
    sequence: u8,
    cid: [u8; 16],
    /// `None` = multicast, por todas las redes.
    target: Option<SocketAddrV4>,
    sockets: Vec<(Ipv4Addr, UdpSocket)>,
    looked_at: Instant,
    last_frame: [u8; CHANNEL_COUNT],
}

impl SacnOutput {
    /// `host` vacío = multicast.
    pub fn open(host: &str, universe: u16) -> Result<Self, DmxOutputError> {
        Self::with_port(host, universe, SACN_PORT)
    }

    fn with_port(host: &str, universe: u16, port: u16) -> Result<Self, DmxOutputError> {
        if !(1..=63999).contains(&universe) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Los universos de sACN van de 1 a 63999").into());
        }
        let target = match host.trim() {
            "" => None,
            host => Some(SocketAddrV4::new(
                host.parse().map_err(|_| {
                    io::Error::new(io::ErrorKind::InvalidInput, format!("{host} no es una dirección IP"))
                })?,
                port,
            )),
        };
        let mut output = Self {
            universe,
            sequence: 0,
            cid: component_id(),
            target,
            sockets: Vec::new(),
            looked_at: Instant::now(),
            last_frame: [0; CHANNEL_COUNT],
        };
        if target.is_some() {
            output.sockets.push((Ipv4Addr::UNSPECIFIED, UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))?));
        } else {
            output.refresh();
        }
        Ok(output)
    }

    /// Un socket por red: el multicast sale por una sola, y no siempre por la
    /// que tiene los nodos.
    fn refresh(&mut self) {
        self.looked_at = Instant::now();
        let now: Vec<Ipv4Addr> = interfaces().into_iter().map(|(ip, _)| ip).collect();
        self.sockets.retain(|(ip, _)| now.contains(ip));
        for ip in now {
            if self.sockets.iter().any(|(known, _)| *known == ip) {
                continue;
            }
            let open = || -> io::Result<UdpSocket> {
                let socket = udp()?;
                socket.bind(&SockAddr::from(SocketAddrV4::new(ip, 0)))?;
                socket.set_multicast_if_v4(&ip)?;
                socket.set_multicast_ttl_v4(8)?;
                Ok(socket.into())
            };
            if let Ok(socket) = open() {
                self.sockets.push((ip, socket));
            }
        }
    }

    fn send(&mut self, options: u8) -> io::Result<()> {
        self.sequence = self.sequence.wrapping_add(1);
        let packet = sacn_packet(self.universe, self.sequence, options, &self.cid, &self.last_frame);
        let target = self.target.unwrap_or(SocketAddrV4::new(sacn_group(self.universe), SACN_PORT));
        let mut result = Err(io::Error::new(io::ErrorKind::NotConnected, "Esta PC no está en ninguna red"));
        for (_, socket) in &self.sockets {
            let sent = socket.send_to(&packet, target);
            if sent.is_ok() || result.is_err() {
                result = sent;
            }
        }
        result.map(|_| ())
    }
}

impl DmxOutput for SacnOutput {
    fn send_frame(&mut self, frame: &[u8; CHANNEL_COUNT]) -> Result<(), DmxOutputError> {
        if self.target.is_none() && self.looked_at.elapsed() >= INTERFACES_EVERY {
            self.refresh();
        }
        self.last_frame = *frame;
        self.send(0)?;
        Ok(())
    }

    fn name(&self) -> String {
        match self.target {
            Some(target) => format!("sACN {} ({})", self.universe, target.ip()),
            None => format!("sACN {}", self.universe),
        }
    }
}

impl Drop for SacnOutput {
    /// La norma pide avisar tres veces que no hay más datos: los receptores lo
    /// sueltan al instante en vez de esperar.
    fn drop(&mut self) {
        for _ in 0..3 {
            let _ = self.send(STREAM_TERMINATED);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp() -> [u8; CHANNEL_COUNT] {
        std::array::from_fn(|i| (i % 256) as u8)
    }

    fn receiver() -> (UdpSocket, u16) {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let port = socket.local_addr().unwrap().port();
        (socket, port)
    }

    fn receive(socket: &UdpSocket) -> Vec<u8> {
        let mut buffer = [0u8; 1024];
        let (len, _) = socket.recv_from(&mut buffer).unwrap();
        buffer[..len].to_vec()
    }

    #[test]
    fn artnet_packets_follow_the_layout_of_the_spec() {
        let p = artnet_packet(0x1234, 7, &ramp());
        assert_eq!(p.len(), 530);
        assert_eq!(&p[..8], b"Art-Net\0");
        assert_eq!(p[8..10], [0x00, 0x50]); // OpDmx, byte bajo primero
        assert_eq!(p[10..12], [0, 14]);
        assert_eq!((p[12], p[13]), (7, 0));
        assert_eq!((p[14], p[15]), (0x34, 0x12)); // SubUni, Net
        assert_eq!(p[16..18], [2, 0]); // 512, byte alto primero
        assert_eq!(p[18..], ramp());
    }

    #[test]
    fn artnet_reaches_the_node_with_every_value_and_a_sequence_that_skips_zero() {
        let (socket, port) = receiver();
        let mut output = ArtNetOutput::with_port("127.0.0.1", 3, port).unwrap();
        let mut sequences = Vec::new();
        for _ in 0..300 {
            output.send_frame(&ramp()).unwrap();
            let p = receive(&socket);
            assert_eq!(p[18..], ramp());
            sequences.push(p[12]);
        }
        assert_eq!((sequences[0], sequences[254], sequences[255]), (1, 255, 1));
        assert!(!sequences.contains(&0));
        assert_eq!(output.name(), "Art-Net 3 (127.0.0.1)");
    }

    #[test]
    fn sacn_packets_follow_the_layout_of_the_spec() {
        let cid = [9u8; 16];
        let p = sacn_packet(0x0102, 5, 0, &cid, &ramp());
        assert_eq!(p.len(), 638);
        assert_eq!(p[..4], [0x00, 0x10, 0x00, 0x00]);
        assert_eq!(&p[4..16], b"ASC-E1.17\0\0\0");
        assert_eq!(p[16..18], [0x72, 0x6E]); // 0x7000 | 622
        assert_eq!(p[18..22], [0, 0, 0, 4]);
        assert_eq!(p[22..38], cid);
        assert_eq!(p[38..40], [0x72, 0x58]); // 0x7000 | 600
        assert_eq!(p[40..44], [0, 0, 0, 2]);
        assert_eq!(&p[44..53], b"LUMEN PRO");
        assert_eq!(p[53..108], [0; 55]);
        assert_eq!(p[108], 100); // prioridad
        assert_eq!(p[109..111], [0, 0]); // sin sincronía
        assert_eq!((p[111], p[112]), (5, 0));
        assert_eq!(p[113..115], [1, 2]); // universo, byte alto primero
        assert_eq!(p[115..117], [0x72, 0x0B]); // 0x7000 | 523
        assert_eq!(p[117..125], [0x02, 0xA1, 0, 0, 0, 1, 2, 1]);
        assert_eq!(p[125], 0); // start code
        assert_eq!(p[126..], ramp());
    }

    #[test]
    fn sacn_reaches_the_receiver_and_says_goodbye_when_closed() {
        let (socket, port) = receiver();
        let mut output = SacnOutput::with_port("127.0.0.1", 1, port).unwrap();
        output.send_frame(&ramp()).unwrap();
        let p = receive(&socket);
        assert_eq!((p[126..].to_vec(), p[112]), (ramp().to_vec(), 0));
        drop(output);
        for _ in 0..3 {
            assert_eq!(receive(&socket)[112], STREAM_TERMINATED);
        }
    }

    #[test]
    fn sacn_multicast_groups_and_limits() {
        assert_eq!(sacn_group(1), Ipv4Addr::new(239, 255, 0, 1));
        assert_eq!(sacn_group(256), Ipv4Addr::new(239, 255, 1, 0));
        assert!(SacnOutput::open("", 0).is_err());
        assert!(SacnOutput::open("", 64000).is_err());
    }

    #[test]
    fn the_component_id_is_stable_and_looks_like_a_uuid() {
        let id = component_id();
        assert_eq!(id, component_id());
        assert_eq!((id[6] >> 4, id[8] >> 6), (5, 0b10));
    }

    #[test]
    fn a_wrong_address_is_an_error_with_a_readable_message() {
        let error = ArtNetOutput::open("no es ip", 0).err().unwrap().to_string();
        assert!(error.contains("no es una dirección IP"), "{error}");
    }

    /// Respuesta de un nodo de dos salidas, armada según la norma.
    fn poll_reply() -> Vec<u8> {
        let mut p = vec![0u8; 239];
        p[..8].copy_from_slice(ARTNET_ID);
        p[8..10].copy_from_slice(&OP_POLL_REPLY.to_le_bytes());
        p[10..14].copy_from_slice(&[192, 168, 1, 77]);
        p[14..16].copy_from_slice(&ARTNET_PORT.to_le_bytes());
        p[18] = 1; // Net
        p[19] = 2; // Sub-Net
        p[26..30].copy_from_slice(b"Nodo");
        p[44..58].copy_from_slice(b"Nodo de prueba");
        p[173] = 3;
        p[174..178].copy_from_slice(&[0x80, 0x80, 0x40, 0]); // dos salidas y una entrada
        p[190..194].copy_from_slice(&[4, 5, 6, 0]);
        p
    }

    #[test]
    fn poll_replies_tell_name_address_and_universes() {
        let node = parse_poll_reply(&poll_reply()).unwrap();
        assert_eq!(node.ip, Ipv4Addr::new(192, 168, 1, 77));
        assert_eq!((node.short_name.as_str(), node.long_name.as_str()), ("Nodo", "Nodo de prueba"));
        assert_eq!(node.universes, [0x124, 0x125]);
    }

    #[test]
    fn garbage_and_other_packets_are_not_nodes() {
        assert_eq!(parse_poll_reply(b""), None);
        assert_eq!(parse_poll_reply(&poll_reply()[..150]), None);
        assert_eq!(parse_poll_reply(&artnet_packet(0, 1, &ramp())), None);
        assert_eq!(poll_packet().len(), 14);
    }
}
