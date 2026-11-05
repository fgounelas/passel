# Attribution

Passel is derived from [kcosr/herdr-web](https://github.com/kcosr/herdr-web),
starting from v0.5.2. The original project's MIT license is retained in `LICENSE`.
Passel's own release numbering starts at v0.1.0; see `CHANGELOG.md`.

## Upstream contributor acknowledgements

The inherited herdr-web changelog credited work by the following contributors
and source forks:

- [Andreas Ahrens (@AndreasAhrens)](https://github.com/AndreasAhrens)
- [Craig P. Motlin (@motlin)](https://github.com/motlin)
- [Trillium Smith (@trillium)](https://github.com/trillium)
- [Will Hampson (@Whamp)](https://github.com/Whamp)
- [shuv (@shuv1337)](https://github.com/shuv1337)
- [Hopkins (@LosEcher)](https://github.com/LosEcher)
- [Philippe SEGATORI (@tigitz)](https://github.com/tigitz)
- [Alexander Makarov (@AlexanderMakarov)](https://github.com/AlexanderMakarov)
- [@roy-levi-amazon](https://github.com/roy-levi-amazon)

## Herdr compatibility code

`vendor/herdr-compat/` contains copied and adapted source from
[Herdr](https://herdr.dev/tui/), maintained upstream at
[herdrdev/herdr](https://github.com/herdrdev/herdr). The Herdr-derived portions
remain licensed under Apache-2.0; their licence is included in
[vendor/herdr-compat/LICENSE-APACHE](vendor/herdr-compat/LICENSE-APACHE).

Local compatibility changes and glue from herdr-web and Passel remain covered by
the MIT licence, also included as
[vendor/herdr-compat/LICENSE-MIT](vendor/herdr-compat/LICENSE-MIT). The crate's
[attribution notice](vendor/herdr-compat/NOTICE.md) identifies the upstream
references and local adaptations. These notices do not relicense Herdr's code
under MIT. The developer refresh guide is `docs/vendoring.md`.

## Other bundled material

Full dependency, font, icon and WebAssembly notices are collected in
`THIRD_PARTY_NOTICES.txt`, with provenance and update instructions in
[third-party/README.md](third-party/README.md). The terminal font's original OFL
is also retained at `web/public/fonts/OFL.txt`. The PDF fallback font sources
accompany prepared web assets. Each component retains its own licence.

This source snapshot intentionally starts without the development checkout's Git
history. That does not remove the original copyright or attribution requirements.
