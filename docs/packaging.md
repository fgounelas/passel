# Packaging

Passel is distributed as desktop bridge/web tarballs and a Docker image.

The desktop tarball does not include Herdr itself. Users need a running Herdr
session reporting a reviewed terminal protocol: `20` with Herdr `v0.8.2+`, or
`22` with Herdr `v0.9.3+`. The bundled bridge connects to the normal Herdr socket.

## Release Artifacts

Recommended GitHub release assets:

```text
passel-vX.Y.Z-linux-x86_64.tar.gz
passel-vX.Y.Z-linux-x86_64.tar.gz.sha256
passel-vX.Y.Z-macos-arm64.tar.gz
passel-vX.Y.Z-macos-arm64.tar.gz.sha256
passel-vX.Y.Z-macos-x86_64.tar.gz
passel-vX.Y.Z-macos-x86_64.tar.gz.sha256
```

Build or provide Linux artifacts from a Linux environment, macOS ARM artifacts from an Apple Silicon
Mac environment, and macOS x86_64 artifacts from an Intel Mac environment.
Local release operators may use supplemental
build-service instructions for those environments, but the artifact names and layouts below remain
the source of truth.

## Desktop Tarball Shape

```text
passel-vX.Y.Z-PLATFORM/
  bin/passel
  bin/passel-bridge
  share/passel/web/
  README.md
  LICENSE
  NOTICE.md
  SECURITY.md
  THIRD_PARTY_NOTICES.txt
  third-party/
    README.md
    inventory.json
  vendor/herdr-compat/
    LICENSE-APACHE
    LICENSE-MIT
    NOTICE.md
```

`bin/passel` is a small wrapper that runs `passel-bridge` with `--static-dir` pointed at the
bundled web assets.

The attribution files cover the MIT-licensed application and the Apache-2.0
Herdr-derived compatibility code linked into the bridge. Keep these files in
redistributed bundles. `THIRD_PARTY_NOTICES.txt` covers the collected dependency,
font, icon and WebAssembly notices; `third-party/README.md` explains their scope.
The prepared web assets also contain these notices and the matching Liberation
font source archive. Web builds reject stale notice inventories.

## Build A Desktop Tarball

Install dependencies first:

- Node.js 22.12 or newer
- npm
- Rust stable
- a platform C toolchain usable by Cargo

```bash
npm ci
npm ci --prefix web
```

Build the tarball:

```bash
scripts/package-tarball.sh vX.Y.Z linux-x86_64
```

On macOS ARM:

```bash
scripts/package-tarball.sh vX.Y.Z macos-arm64
```

On macOS Intel:

```bash
scripts/package-tarball.sh vX.Y.Z macos-x86_64
```

The output is written under `dist-packages/`:

```text
dist-packages/passel-vX.Y.Z-PLATFORM.tar.gz
dist-packages/passel-vX.Y.Z-PLATFORM.tar.gz.sha256
```

Before uploading or distributing a desktop tarball, inspect it:

```bash
tar -tzf dist-packages/passel-vX.Y.Z-PLATFORM.tar.gz
cat dist-packages/passel-vX.Y.Z-PLATFORM.tar.gz.sha256
```

Confirm the archive contains the expected root directory, `bin/passel`,
`bin/passel-bridge`, bundled `share/passel/web/` assets, `README.md`, and
the licence/attribution files listed above.

Before release, run the unpacked wrapper against both reviewed combinations:
Herdr `v0.8.2+`/protocol `20` and Herdr `v0.9.3+`/protocol `22`. Confirm it rejects
unreviewed protocols. Complete the launcher checks in
[docs/release.md](release.md) with the packaged bridge.

## User Quick Start From Tarball

Start or attach a compatible Herdr session first (protocol `20` or `22`):

```bash
herdr
```

Unpack and run:

```bash
tar -xzf passel-vX.Y.Z-linux-x86_64.tar.gz
cd passel-vX.Y.Z-linux-x86_64
bin/passel
```

Open:

```text
http://127.0.0.1:8787
```

For browser-served multi-bridge use, configure both the page-serving bridge and the bridge being
called. If a page opened from `http://host-a:8787` should connect to `http://host-b:8787`, run host
A with:

```bash
bin/passel --host 0.0.0.0 --allow-host host-a --allow-connect-origin http://host-b:8787
```

Run host B with:

```bash
bin/passel --host 0.0.0.0 --allow-host host-b --allow-origin http://host-a:8787
```

`--allow-origin` accepts inbound browser calls to a bridge. `--allow-connect-origin` expands the
served page's Content Security Policy so that page can connect to another bridge over HTTP and
WebSocket.

## Manual Release Upload

The release script creates the GitHub release from changelog notes. Separately packaged tarballs
are uploaded manually after the release exists.

Upload the Linux tarball from the Linux build host:

```bash
gh release upload vX.Y.Z \
  dist-packages/passel-vX.Y.Z-linux-x86_64.tar.gz \
  dist-packages/passel-vX.Y.Z-linux-x86_64.tar.gz.sha256
```

Upload the macOS ARM tarball from the Apple Silicon Mac build host, or copy it to the release
operator machine first:

```bash
gh release upload vX.Y.Z \
  dist-packages/passel-vX.Y.Z-macos-arm64.tar.gz \
  dist-packages/passel-vX.Y.Z-macos-arm64.tar.gz.sha256
```

Upload the macOS Intel tarball from the Intel Mac build host, or copy it to the release operator
machine first:

```bash
gh release upload vX.Y.Z \
  dist-packages/passel-vX.Y.Z-macos-x86_64.tar.gz \
  dist-packages/passel-vX.Y.Z-macos-x86_64.tar.gz.sha256
```

If every artifact has been copied to one machine, the same paths can be uploaded in one
`gh release upload` invocation.
