# Herdr compatibility attribution

This crate contains copied and adapted source from
[Herdr](https://herdr.dev/tui/), whose upstream repository is
[herdrdev/herdr](https://github.com/herdrdev/herdr).

The Herdr-derived portions are licensed under **Apache-2.0**. The complete,
unmodified upstream licence is supplied in [LICENSE-APACHE](LICENSE-APACHE).
Local compatibility changes and glue from herdr-web and Passel are covered by the
**MIT** licence in [LICENSE-MIT](LICENSE-MIT), including the original herdr-web
copyright notice. The Cargo licence expression `Apache-2.0 AND MIT` records the
combined obligations; it does not offer Herdr's source under MIT alone.

## Upstream references

- Legacy API/schema source reference: Herdr v0.8.0, commit
  [346411fa21afd297f5ed3b3fa56f9e3fbf7654b7](https://github.com/herdrdev/herdr/tree/346411fa21afd297f5ed3b3fa56f9e3fbf7654b7).
- Protocol-20 wire source: Herdr v0.8.2, commit
  [9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c](https://github.com/herdrdev/herdr/tree/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c).
  `src/protocol/wire.rs` is an unchanged copy of that file.
- Additional protocol-22 reference: Herdr v0.9.3, commit
  [7b116c05bfda646af39d2524c54e70c751f57ee8](https://github.com/herdrdev/herdr/tree/7b116c05bfda646af39d2524c54e70c751f57ee8).
  `src/terminal_wire.rs` is a local, restricted adapter for that wire format.

These references carry the same Apache-2.0 licence text. Retain applicable
upstream copyright and attribution notices when refreshing any copied source.
If a future upstream source distribution includes a NOTICE file, preserve its
applicable notices as well.

## Local adaptations

This is a compatibility subset, not a complete distribution of Herdr. Copied
modules retain the licence of their upstream source. Local changes include:

- API client and socket-path helpers adapted to bridge-owned session selection.
- A file logger reduced to the bridge's rotating file writer and log directory.
- Input, raw-input and dependent model shims reduced to the required wire types.
- Bridge-specific label handling in the tab and workspace schema modules.
- Public `PopupSize` visibility for the compatibility API.
- Bridge protocol/schema fixtures and restricted protocol-22 message handling.
- Module wiring and small build/configuration shims for this standalone crate.

Modified Herdr-derived files carry a prominent local-change notice. Unmodified
schema and wire bodies remain available for comparison with the pinned upstream
source. The source distribution's `docs/vendoring.md` documents the file mapping,
refresh procedure and compatibility policy.

Passel is an independent herdr-web fork and is not maintained or endorsed by the
Herdr project. Attribution does not imply endorsement or trademark permission.
