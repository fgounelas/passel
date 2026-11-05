# Docker Compose

One container runs Herdr, the bridge, Conversation/usage observers, the file
service and the browser gateway for one trusted user. A small supervisor starts
them and stops them gracefully. Failed auxiliary services restart independently;
Herdr and its research sessions keep running. A Herdr failure restarts the whole
workspace. One named volume holds the user's projects, settings and sign-ins.

Use Docker Engine/Desktop 28+ with Compose v2 (2.24.4+), on Linux or Docker Desktop's
Linux environment on macOS/Windows. Compose pulls the prebuilt
`ghcr.io/fgounelas/passel:latest` image for Linux AMD64 or ARM64.

## Start

Compose enables localhost-only browser access by default. Start it with:

```sh
docker compose pull
docker compose up -d --wait
```

Open **http://127.0.0.1:8787**. Herdr 0.8.2 (reviewed protocol 20) is included;
there is no separate host Herdr installation in this setup. CI builds and tests
the image before publishing it. `latest` follows `main`; source commit tags use
`sha-COMMIT`, and release tags use versions such as `v0.1.0` after a release.

While the image is private, sign in with `docker login ghcr.io` using a GitHub
account and classic token with `read:packages` access. Public GHCR images can be pulled without
signing in; see [GitHub's registry instructions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

To install and sign in to your research CLI or set up Pharos/Danus:

```sh
docker compose exec passel bash
```

The user is `passel`; its home is `/home/passel`, and its projects are in
`/home/passel/work`. The empty `danus` and `pharos` folders are ready for their
checkouts. Follow [INSTALL_INSTRUCTIONS.md](../INSTALL_INSTRUCTIONS.md) in this
Linux environment. Claude, Codex and Gemini accounts/CLIs are installed and
signed in separately. Gemini uses Antigravity CLI (`agy`) in Terminal mode;
Conversation supports Claude and Codex.

Settings → Setup can check and clone both projects into those folders. It fetches
the current default branch without running project setup scripts; follow each
project's README for dependencies and agent configuration. Existing files and
checkouts are preserved. Settings → Terminal lets you choose an existing startup
directory for new Passel sessions, defaulting to `~/work`. The preference persists
in the user-home volume and does not move existing sessions.
On a fresh volume, Herdr's initial shell also starts in `~/work`. Existing saved
workspaces retain their directories when the container restarts.

The same Setup tab checks versions and installs or updates Claude Code, Codex and
Gemini's Antigravity CLI (`agy`). Installations use the official native installers
and persist under the user home; Antigravity updates use `agy update`. Open a new
Shell session and run `claude`, `codex` or `agy` to sign in. Setup accepts only
these fixed CLIs and actions, runs one installer at a time, and never accepts a
browser-provided download URL or command. Failed installer output stays in private
`~/containers/passel/cli-installs/` logs. Downloads and installers have a bounded
runtime and require the server's internet access.

Node, Python, Git, curl and ripgrep are included. Install project dependencies
in their own environments and user-installed CLIs under `~/.local/bin`. Global
npm installs use `~/.local`, so they work without root and persist in the data
volume. For extra
system packages such as TeX, extend the image in your own Dockerfile. Hand-made
changes to a container's system directories do not survive replacement.

## Storage and lifecycle

The `data` volume persists the whole user home: projects, uploads, credentials,
Herdr layouts, notes, conversation state and caches. Back it up as private
research and account data, outside the source checkout.

Passel's caches, bookmarks, archives and resume launchers live in
`~/containers/passel`. On an existing volume, startup moves the old
`~/containers/herdr-web` directory there. Populated old directories retain a
compatibility symlink so saved launcher paths still work. Fresh volumes create
only the `passel` directory; an empty old directory needs no alias.

```sh
docker compose ps
docker compose logs --tail=100
docker compose stop
docker compose start
```

Closing the browser or an `exec` shell leaves research sessions running.
Stopping or recreating the container stops its agent processes. Saved files and
layouts persist; a saved layout does not automatically resume an interrupted
proof attempt. Update between research jobs with `docker compose pull` followed
by `docker compose up -d --wait`, retaining the same data volume.

## Access and trust

The host mapping binds only to `127.0.0.1`, so it is local access rather
than a public listening port. It also works for a reverse proxy running on the
host. A proxy container on the same Docker network can use `passel:8080`; remove
the `ports` block in that case. The internal bridge and file listener stay on container
loopback. All processes run as the same non-root
user; they share its filesystem. The container is one trusted user's workspace,
with no separate filesystem boundary between its internal components. The file
API still restricts which project paths it will serve.

For a server using the localhost mapping, connect from your laptop with:

```sh
ssh -N -L 8787:127.0.0.1:8787 YOUR_USERNAME@YOUR_SERVER_ADDRESS
```

Then open http://127.0.0.1:8787 locally. For domain access, put an authenticated
HTTPS gateway in front, such as the README's Pangolin/Traefik and Pocket ID setup.
Preserve the browser's Host/Origin and proxy WebSockets. Passel's container has no
user login of its own; see [SECURITY.md](../SECURITY.md).

A second user needs a separate Compose project, volume and access rule. Before
starting it, remove `ports` for direct proxy access, or choose a different host
port and set `PASSEL_ORIGIN` to its matching browser address:

```sh
docker compose -p passel-second up -d --wait
```

For a proxy, uncomment `PASSEL_ORIGIN` and set it to the exact external browser
origin, without a path or trailing slash. Do not share
home/credential volumes between group members. Connect a shared proxy to each
instance's separate network rather than placing all research containers on one
shared network. With several instances, use their unique container DNS names in
the proxy, such as `passel-second-passel-1`, rather than the shared `passel` alias.

## Verification

CI builds the actual image and tests a disposable workspace, including terminal
input/output through WebSockets, file/PDF delivery, uploads, Host/Origin checks,
project-path restrictions, auxiliary-service recovery, persistence and legacy
state migration after container replacement, and notices. It also installs and
updates the three CLIs on both architectures and checks that their versions
persist after container replacement, without signing in or making model calls.
To run the same check on a disposable instance:

```sh
docker compose -f compose.yaml -f docker/compose.test.yaml -p passel-smoke up -d --wait
python3 scripts/smoke-compose.py --project passel-smoke
```

Add `--install-clis` to the smoke command to include the official CLI downloads
and install/update checks. This changes only the disposable test volume.

The smoke check uses sample files and a disposable shell, with no provider
requests. Verify real CLI sign-in, Conversation discovery/replies and Pharos/Danus
setup separately before relying on a research deployment.
