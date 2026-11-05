// Modified for herdr-web/Passel: implement a restricted protocol-22 adapter.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

//! Narrow direct-terminal adapter for Herdr 0.9.3 (protocol 22).
//!
//! Reference: herdrdev/herdr 7b116c05bfda646af39d2524c54e70c751f57ee8,
//! src/protocol/wire.rs. Protocol 20 remains unchanged in `protocol`.
//! Bincode enum tags are encoded as u32 followed by variant fields, in order.
//! Only direct-terminal commands are writable; client-shell and graphics commands
//! are deliberately not exposed. Ignored server frames remain size-bounded.
use crate::protocol::{
    self, ClientInputEvent, ClientMessage, ClientMouseButton, ClientMouseKind, RenderEncoding,
    ServerMessage, TerminalFrame,
};
use serde::{de::DeserializeOwned, Serialize};
use std::io::{self, Read, Write};

pub const PROTOCOL_V22: u32 = 22;

fn invalid(message: impl ToString) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_string())
}

fn encode(value: impl Serialize) -> io::Result<Vec<u8>> {
    bincode::serde::encode_to_vec(value, bincode::config::standard()).map_err(invalid)
}

pub fn write_message<W: Write>(
    writer: &mut W,
    message: &ClientMessage,
    version: u32,
) -> io::Result<()> {
    if version == protocol::PROTOCOL_VERSION {
        return protocol::write_message(writer, message).map_err(invalid);
    }
    if version != PROTOCOL_V22 {
        return Err(invalid("unreviewed terminal protocol"));
    }
    let bytes = match message {
        ClientMessage::Hello {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
            ..
        } => encode((
            0u32,
            version,
            cols,
            rows,
            cell_width_px,
            cell_height_px,
            false,
        ))?,
        ClientMessage::Input { data } => encode((1u32, data))?,
        ClientMessage::InputEvents { events } => {
            let [ClientInputEvent::Mouse {
                kind,
                column,
                row,
                modifiers,
            }] = events.as_slice()
            else {
                return Err(invalid("unsupported direct-terminal event"));
            };
            if !matches!(
                kind,
                ClientMouseKind::Down(ClientMouseButton::Left)
                    | ClientMouseKind::Up(ClientMouseButton::Left)
            ) || *column >= 500
                || *row >= 200
                || modifiers & !6 != 0
            {
                return Err(invalid("invalid direct-terminal mouse event"));
            }
            // Reviewed v22 AttachMouse tag16, Cell position tag0, no pixel geometry.
            encode((
                16u32,
                kind,
                (0u32, column, row),
                None::<()>,
                modifiers,
                1u16,
            ))?
        }
        ClientMessage::Resize {
            cols,
            rows,
            cell_width_px,
            cell_height_px,
        } => encode((3u32, cols, rows, cell_width_px, cell_height_px, false))?,
        ClientMessage::Detach => encode(4u32)?,
        ClientMessage::AttachTerminal {
            terminal_id,
            takeover,
        } => encode((5u32, terminal_id, takeover))?,
        ClientMessage::AttachScroll {
            source,
            direction,
            lines,
            column,
            row,
            modifiers,
        } => encode((6u32, source, direction, lines, column, row, modifiers))?,
        _ => return Err(invalid("unsupported direct-terminal command")),
    };
    if bytes.len() > protocol::MAX_FRAME_SIZE {
        return Err(invalid("terminal command too large"));
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(&bytes)
}

fn decode<T: DeserializeOwned>(bytes: &[u8]) -> io::Result<T> {
    let (value, used) = bincode::serde::decode_from_slice(
        bytes,
        bincode::config::standard().with_limit::<{ protocol::MAX_GRAPHICS_FRAME_SIZE }>(),
    )
    .map_err(invalid)?;
    if used != bytes.len() {
        return Err(invalid("trailing terminal frame data"));
    }
    Ok(value)
}

pub fn read_message<R: Read>(
    reader: &mut R,
    limit: usize,
    version: u32,
) -> io::Result<ServerMessage> {
    if version == protocol::PROTOCOL_VERSION {
        return protocol::read_message(reader, limit).map_err(invalid);
    }
    if version != PROTOCOL_V22 {
        return Err(invalid("unreviewed terminal protocol"));
    }
    let mut prefix = [0; 4];
    reader.read_exact(&mut prefix)?;
    let length = u32::from_le_bytes(prefix) as usize;
    if length == 0 || length > limit.min(protocol::MAX_GRAPHICS_FRAME_SIZE) {
        return Err(invalid("invalid terminal frame length"));
    }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes)?;
    // All reviewed ServerMessage discriminants fit in one standard-bincode byte.
    match bytes[0] {
        0 => {
            let (_, version, encoding, error): (u32, u32, RenderEncoding, Option<String>) =
                decode(&bytes)?;
            if version != PROTOCOL_V22 || encoding != RenderEncoding::TerminalAnsi {
                return Err(invalid("unexpected terminal handshake version or encoding"));
            }
            Ok(ServerMessage::Welcome {
                version,
                encoding,
                error,
            })
        }
        1 => {
            let (_, frame): (u32, TerminalFrame) = decode(&bytes)?;
            Ok(ServerMessage::Terminal(frame))
        }
        3 => {
            let (_, reason): (u32, Option<String>) = decode(&bytes)?;
            Ok(ServerMessage::ServerShutdown { reason })
        }
        8 => {
            let (_, enabled, sgr_pixels): (u32, bool, bool) = decode(&bytes)?;
            Ok(ServerMessage::MouseCapture {
                enabled,
                sgr_pixels,
            })
        }
        // Non-rendered direct-terminal notifications. Never interpret or execute
        // filesystem paths, clipboard data or shell/graphics requests from them.
        2 | 4..=7 | 9..=11 | 16 => Ok(ServerMessage::ReloadSoundConfig),
        _ => Err(invalid("unexpected message on direct-terminal connection")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{
        AttachScrollDirection, AttachScrollSource, ClientKeybindings, ClientLaunchMode,
    };
    fn framed(bytes: &[u8]) -> Vec<u8> {
        [(bytes.len() as u32).to_le_bytes().as_slice(), bytes].concat()
    }
    #[test]
    fn protocol22_direct_commands_match_upstream_tags_and_fields() {
        let hello = ClientMessage::Hello {
            version: 22,
            cols: 80,
            rows: 24,
            cell_width_px: 0,
            cell_height_px: 0,
            requested_encoding: RenderEncoding::TerminalAnsi,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
        };
        for (message, expected) in [
            (hello, vec![0, 22, 80, 24, 0, 0, 0]),
            (ClientMessage::Input { data: vec![65] }, vec![1, 1, 65]),
            (
                ClientMessage::InputEvents {
                    events: vec![ClientInputEvent::Mouse {
                        kind: ClientMouseKind::Down(ClientMouseButton::Left),
                        column: 99,
                        row: 0,
                        modifiers: 0,
                    }],
                },
                vec![16, 0, 0, 0, 99, 0, 0, 0, 1],
            ),
            (
                ClientMessage::InputEvents {
                    events: vec![ClientInputEvent::Mouse {
                        kind: ClientMouseKind::Up(ClientMouseButton::Left),
                        column: 26,
                        row: 8,
                        modifiers: 6,
                    }],
                },
                vec![16, 1, 0, 0, 26, 8, 0, 6, 1],
            ),
            (
                ClientMessage::Resize {
                    cols: 80,
                    rows: 24,
                    cell_width_px: 0,
                    cell_height_px: 0,
                },
                vec![3, 80, 24, 0, 0, 0],
            ),
            (ClientMessage::Detach, vec![4]),
            (
                ClientMessage::AttachTerminal {
                    terminal_id: "t".into(),
                    takeover: false,
                },
                vec![5, 1, 116, 0],
            ),
            (
                ClientMessage::AttachScroll {
                    source: AttachScrollSource::Wheel,
                    direction: AttachScrollDirection::Up,
                    lines: 6,
                    column: Some(40),
                    row: Some(12),
                    modifiers: 0,
                },
                vec![6, 0, 0, 6, 1, 40, 1, 12, 0],
            ),
        ] {
            let mut bytes = Vec::new();
            write_message(&mut bytes, &message, 22).unwrap();
            assert_eq!(bytes, framed(&expected));
        }
    }
    #[test]
    fn reads_v22_frames_and_rejects_invalid_framing() {
        assert!(matches!(
            read_message(&mut framed(&[0, 22, 1, 0]).as_slice(), 100, 22).unwrap(),
            ServerMessage::Welcome { .. }
        ));
        let frame = framed(&[1, 1, 80, 24, 1, 1, 65]);
        match read_message(&mut frame.as_slice(), 100, 22).unwrap() {
            ServerMessage::Terminal(frame) => assert_eq!(frame.bytes, b"A"),
            _ => panic!("expected terminal frame"),
        }
        for bad in [
            framed(&[0, 20, 1, 0]),
            framed(&[0, 22, 0, 0]),
            framed(&[1, 1, 80, 24, 1, 1, 65, 99]),
            framed(&[255]),
            vec![255, 255, 255, 255],
        ] {
            assert!(read_message(&mut bad.as_slice(), 100, 22).is_err());
        }
        assert!(matches!(
            read_message(&mut framed(&[3, 0]).as_slice(), 100, 22).unwrap(),
            ServerMessage::ServerShutdown { .. }
        ));
    }
    #[test]
    fn reads_v22_mouse_capture_and_rejects_malformed_notifications() {
        for enabled in [false, true] {
            assert!(matches!(
                read_message(&mut framed(&[8, enabled as u8, 0]).as_slice(), 100, 22).unwrap(),
                ServerMessage::MouseCapture { enabled: actual, sgr_pixels: false } if actual == enabled
            ));
        }
        for bad in [vec![8], vec![8, 2, 0], vec![8, 1, 0, 99]] {
            assert!(read_message(&mut framed(&bad).as_slice(), 100, 22).is_err());
        }
    }

    #[test]
    fn protocol20_encoding_is_unchanged_and_unknown_protocol_is_rejected() {
        let mut expected = Vec::new();
        protocol::write_message(&mut expected, &ClientMessage::Detach).unwrap();
        let mut actual = Vec::new();
        write_message(&mut actual, &ClientMessage::Detach, 20).unwrap();
        assert_eq!(actual, expected);
        assert!(write_message(&mut actual, &ClientMessage::Detach, 23).is_err());
    }
}
