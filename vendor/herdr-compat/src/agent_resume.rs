// Modified for herdr-web/Passel: retain only agent session-reference schema types.
// Herdr-derived portions: Apache-2.0; local changes: MIT. See this crate's NOTICE.md.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionRefKind {
    Id,
    Path,
}
