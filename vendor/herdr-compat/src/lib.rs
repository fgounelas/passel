// Modified for herdr-web/Passel: wire up the standalone compatibility crate.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

#![allow(dead_code, deprecated)]

pub mod agent_resume;
pub mod api;
pub mod build_info;
pub mod config;
pub mod input;
pub mod ipc;
pub mod logging;
pub mod popup_size;
pub mod protocol;
pub mod raw_input;
pub mod server;
pub mod sound;

pub use interprocess::TryClone;

pub mod terminal_wire;
