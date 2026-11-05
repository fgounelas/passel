// Modified for herdr-web/Passel: reduce API module wiring to the compatibility subset.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

pub mod client;
pub mod schema;
mod status;

pub use status::RuntimeStatus;

pub const SOCKET_PATH_ENV_VAR: &str = "HERDR_SOCKET_PATH";
