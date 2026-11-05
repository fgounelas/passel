// Modified for herdr-web/Passel: retain only sound-setting schema types.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sound {
    Done,
    Request,
}
