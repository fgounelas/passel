# Vendoring Herdr Compatibility

Passel vendors a small Herdr compatibility crate because the bridge depends on private API and
wire protocol details that are not exposed as a stable Herdr library or daemon API.

## What Is Vendored

`vendor/herdr-compat/` is the only vendored Herdr source in this repository. It is a minimal local
Rust crate containing copied or lightly pruned compatibility code needed by `passel-bridge`:

- JSON API client, status, request, response, and event schema types.
- Terminal attach wire protocol messages, framing, protocol constants, and frame data types.
- Local socket connection helpers.
- Client socket path derivation helpers.
- Small dependent model shims needed by copied schema/protocol modules.
- Bridge file logging adapted to accept a bridge-owned log directory.

`bridge/` remains the repo-owned executable:

- `bridge/src/main.rs` exposes the `passel-bridge` command.
- `bridge/src/session.rs` owns active Herdr session, config directory, and socket path selection.
- `bridge/src/web_bridge.rs` owns the HTTP/WebSocket bridge implementation and browser command
  allow-list.
- `bridge/src/workspace.rs` owns web-specific workspace label derivation.

The full upstream Herdr source tree is intentionally not vendored. Do not recreate `vendor/herdr/`
or path-import files from an upstream checkout at build time.

The browser app is not vendored into Herdr. It lives at `web/`, and `passel-bridge` serves
`web/dist` through `--static-dir`.

## Licensing And Attribution

Herdr-derived source retains its Apache-2.0 licence, supplied in
[`vendor/herdr-compat/LICENSE-APACHE`](../vendor/herdr-compat/LICENSE-APACHE).
Local compatibility changes and glue retain the MIT licence in
[`LICENSE-MIT`](../vendor/herdr-compat/LICENSE-MIT). The crate's
[`NOTICE.md`](../vendor/herdr-compat/NOTICE.md) records provenance and adaptations;
the root [`NOTICE.md`](../NOTICE.md) links these obligations to the application.

Preserve applicable upstream notices when refreshing source. Keep prominent
change notices in adapted files, and retain both licences and the attribution
notice in source exports and desktop bundles. Do not label the copied Herdr
portions as MIT-only. Unmodified source copies stay byte-for-byte comparable.

## Current Reference

- Upstream checkout: a clean Herdr source checkout outside this repository
- API/schema source baseline: `v0.8.0`, commit
  `346411fa21afd297f5ed3b3fa56f9e3fbf7654b7`.
- Protocol-20 wire source: `v0.8.2`, commit
  `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`.
- Legacy runtime release baseline: `v0.8.2`.
- Legacy terminal wire baseline: protocol `20` (unchanged).
- Additional direct-terminal adapter: Herdr `v0.9.3`, protocol `22`, commit
  `7b116c05bfda646af39d2524c54e70c751f57ee8`. `terminal_wire.rs` maps only the
  bridge's handshake/input/resize/attach/scroll/detach commands and reads terminal
  frames, handshake, shutdown and mouse-capture messages. It uses explicit reviewed bincode tags
  and field order, rather than copying the new client-owned shell implementation.
  Other non-rendered direct-terminal notifications are discarded within the frame cap;
  unexpected shell messages and future protocols fail closed.

Use the upstream checkout as an external reference for audits and refreshes. It is not required to
build Passel.

## Why This Shape

The bridge needs private pieces from Herdr:

- `api::client::ApiClient`
- API schema enums and response types
- `protocol::{ClientMessage, ServerMessage, RenderEncoding, ...}`
- local IPC socket helpers
- protocol version constants
- terminal attach launch mode, resize, scroll, and input frames

Vendoring only `vendor/herdr-compat` keeps these dependencies explicit without carrying the full
Herdr app, website, CI, terminal runtime build path, or legacy `herdr web-bridge` overlay. The cost
is that copied private protocol/API code can drift from upstream Herdr, so refreshes must be
intentional and reviewed.

The compatibility crate currently keeps `ratatui` and `crossterm` because upstream
`protocol::wire` includes semantic frame and input conversion types next to the terminal attach
messages used by the bridge. `passel-bridge` requests terminal ANSI rendering, but keeping the
wire module broad makes protocol drift reviewable against upstream. Revisit this tradeoff if the
bridge narrows the drift check to only the terminal attach message regions.

## Refresh Process

Use clean Herdr checkouts at the reviewed source references above. Do not
refresh from an experimental tree that may contain unrelated local drift. Copy the reviewed
upstream source files into the minimal compatibility crate; do not make the bridge compile against
the external checkout or recreate a full upstream vendor snapshot.

```bash
HERDR_SRC=/path/to/herdr
HERDR_V20_SRC=/path/to/herdr-v0.8.2
PASSEL=/path/to/passel
```

1. Verify the source checkout is clean:

```bash
git -C "$HERDR_SRC" status --short
git -C "$HERDR_SRC" rev-parse --short HEAD
```

2. Reconcile only the compatibility surface:

```text
src/api/client.rs          -> vendor/herdr-compat/src/api/client.rs
src/api/status.rs          -> vendor/herdr-compat/src/api/status.rs
src/api/schema.rs          -> vendor/herdr-compat/src/api/schema.rs
src/api/schema/*.rs        -> vendor/herdr-compat/src/api/schema/*.rs
src/protocol/wire.rs       -> vendor/herdr-compat/src/protocol/wire.rs (from HERDR_V20_SRC)
src/input/model.rs         -> vendor/herdr-compat/src/input.rs (minimal protocol shim)
src/raw_input.rs           -> vendor/herdr-compat/src/raw_input.rs (minimal protocol shim)
src/ipc.rs                 -> vendor/herdr-compat/src/ipc.rs
src/logging.rs             -> vendor/herdr-compat/src/logging.rs
src/popup_size.rs          -> vendor/herdr-compat/src/popup_size.rs
src/server/socket_paths.rs -> vendor/herdr-compat/src/server/socket_paths.rs
```

3. Preserve intentional local adaptations:

- `ApiClient` takes concrete socket paths; it must not know bridge session rules.
- `logging::init_file_logging` takes a concrete directory from the bridge.
- socket path helpers derive paths from supplied overrides/defaults; bridge session resolution stays
  in `bridge/src/session.rs`.
- `tabs.rs` and `workspaces.rs` keep bridge-internal clear-name sentinel fields; the bridge
  substitutes concrete default labels before forwarding rename requests to Herdr.
- `PopupSize` is public in the compatibility crate because copied public plugin schema fields expose
  it, while upstream keeps the type crate-visible inside the full Herdr crate. This visibility-only
  adaptation is expected by the vendor drift check.
- `input.rs` and `raw_input.rs` retain only the model surface required by the copied wire protocol;
  terminal parsing and host input behavior remain owned by Herdr.
- `protocol.rs` and schema tests include bridge fixture tests for the reviewed protocol/schema
  baseline.

4. Run layout and optional upstream drift checks:

```bash
scripts/check-vendor.sh
HERDR_SRC="$HERDR_SRC" HERDR_V20_SRC="$HERDR_V20_SRC" scripts/check-vendor.sh
```

The optional `HERDR_SRC` mode exact-compares unmodified API/schema files against
v0.8.0. `HERDR_V20_SRC` separately exact-compares the protocol-20 wire file against
v0.8.2. Locally adapted files are excluded from exact comparison and must be
reviewed manually. `PopupSize` is compared with only the documented visibility
adaptation and the fixed local-change notice allowed.

5. Re-run validation:

```bash
npm run lint
npm run test
npm run build
```

6. Smoke test:

```bash
scripts/run-bridge.sh
```

Open `http://127.0.0.1:8787`, attach multiple browser clients, switch panes, type, scroll, and use
the refit button after changing browser sizes.

## Compatibility Policy

The bridge pings Herdr's status API at startup and before a new terminal attach.
It accepts the reviewed pairs: Herdr `v0.8.2+` with protocol `20`, or Herdr
`v0.9.3+` with protocol `22`. Protocol21 and unreviewed newer protocols are rejected.
The protocol20 implementation is retained so a bridge deployment does not force
an immediate Herdr server upgrade. The API schema remains a narrow compatible
subset; smoke tests must cover actual JSON responses and event delivery as well
as terminal binary frames.

The protocol22 adapter's literal-byte tests cover changed enum tags and the new
`pixel_mouse` handshake/resize field (false: browser input uses cell coordinates).
All decoded terminal payloads enforce length caps, decode limits and exact byte
consumption. No clipboard, graphics file, or client-shell action is executed.

For the new reference audit, run:

```bash
HERDR_V22_SRC=/path/to/clean/herdr-v0.9.3 scripts/check-vendor.sh
```

This verifies the pinned source commit and wire-file hash. It complements, rather
than replaces, Rust wire fixtures and live smoke tests against both daemon versions.

When updating Herdr:

- inspect `src/protocol/wire.rs`
- inspect API schema changes under `src/api/schema/`
- inspect terminal attach handling in `src/server/headless.rs`
- rerun the `HERDR_SRC` and `HERDR_V20_SRC` source checks above
- rerun bridge tests and a browser smoke test
- update this document if the bridge compatibility surface changes

## Long-Term Removal Condition

Remove `vendor/herdr-compat` when Herdr exposes enough public surface for the bridge to live outside
Herdr:

- public snapshot/events API
- public terminal websocket or stable terminal attach protocol crate
- multi-client terminal fanout or documented attach ownership
- exact pane focus/selection endpoint
- resize ownership model
- browser authentication story

## Two-version smoke test

On a Linux test host, build the bridge and provide separate upstream binaries.
The script creates fresh HOME/XDG directories, starts shell-only test sessions,
uses ephemeral loopback ports, and stops only the sessions it created. Logs remain
in the printed temporary directory. Never substitute a live session socket.

```bash
python3 scripts/smoke-herdr-compat.py \
  --herdr-old /path/to/herdr-0.8.2 \
  --herdr-new /path/to/herdr-0.9.3 \
  --bridge /path/to/passel-bridge \
  --static-dir web/dist
```

It checks snapshots, API commands/events, terminal input/output, resize, host
scrollback, multiple viewers, and detach/reconnect with both transport adapters.
The protocol22 reference binary should be verified against its release checksum.

## Upgrading an existing installation

Deploying this bridge does not require replacing the running Herdr daemon.
Upgrade and smoke-test Passel first. Keep a rollback image and a copy of the old
Herdr executable/configuration before scheduling the daemon upgrade. Upstream's
0.9.x compatible-client behavior does not guarantee a seamless transition from
the pre-endpoint-generation-1 0.8.2 server. A normal server stop ends its pane
processes; restoring saved layouts or Codex transcripts is not the same as keeping
those processes alive. Live handoff is experimental and must be assessed separately.
Homebrew installs do not support `herdr update --handoff`; do not run a package
upgrade or server restart inside an active session on the assumption it is lossless.

Mouse capture is decoded explicitly from protocol 22 server tag 8, with exact
boolean fields and trailing-byte checks. Protocol 20 keeps its original message
decoder. Herdr 0.8.2 does not publish mouse-capture changes to direct terminal
viewers, so application clicks require Herdr 0.9.3. Bounded primary-button cell
events use the reviewed AttachMouse tag 16 on protocol 22; Herdr validates the
application's requested mouse mode and translates to its current encoding.
No pixel input or client-shell control is exposed.
