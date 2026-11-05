// Modified for herdr-web/Passel: retain only raw-input types needed by the wire protocol.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawInputEvent {
    Key(crate::input::TerminalKey),
    Text(crate::input::TextCommit),
    Mouse(crossterm::event::MouseEvent),
    Paste(String),
    OuterFocusGained,
    OuterFocusLost,
}
