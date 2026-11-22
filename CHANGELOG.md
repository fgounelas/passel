# Changelog

## [Unreleased]

### Breaking Changes

### Added

### Changed

- Simplify Claude and Codex usage popovers, show the signed-in Claude account when available, and place Codex credits and reset expiry dates inline.

### Fixed

- Open Pharos worker assignment links in Files. The worker tree exposes only `TASK.md` assignments.
- Show the reported reset time under each Claude usage meter.
- Show refresh progress and results in the usage window. Keep the last reading marked stale when a check fails.
- Show Claude sign-in links, including the current `claude.com/cai/oauth/authorize` flow, as ordinary Conversation text. Allow mouse selection in Terminal even when Claude captures clicks; preserve complete wrapped login URLs when copying or opening them.

### Removed

- Remove the “Empty folder” placeholder from expanded folders in Files.

## [0.1.0] - 2026-11-05

Initial release of Passel.
