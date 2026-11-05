# Installation instructions for Antigravity CLI, Claude Code or Codex

Use this guide when a user asks you to install Passel with Danus, Pharos or both.
The human-facing starting steps and copyable prompts are in
[README.md](README.md#step-by-step-setup-guide-for-a-non-technical-audience).
Read [AGENTS.md](AGENTS.md) as well, and follow each upstream repository's own
instructions when working there.

The aim is a working research workspace for a mathematician, with a clear browser
address and a short operating guide. Inspect the machine and carry out routine
setup work; explain any action that requires the user's own login, passkey or
administrator access. Keep questions brief and ask only for information that
cannot be established from the machine or the user's request.

## Establish the installation target

Determine whether the requested setup is on a laptop or a Linux server, which
account owns the research, and whether this is a new installation or an existing
workspace. Inspect the OS, architecture, available disk space, installed tools,
running services and occupied ports before making changes.

Reuse an existing Passel checkout when supplied. If only a repository URL was
given, clone it into `~/work/passel`; install the minimal download tools first if
needed. A private repository may require the user to complete GitHub sign-in.
Do not substitute another person's repository, account or saved credentials.

Use a regular Linux user account for research. If the user connected as root,
create or select the intended regular account and arrange its access while
preserving the working SSH connection. Perform package administration separately
from the user's research processes.

The installation assistant can be Antigravity CLI (`agy`), Claude Code or Codex;
the research backend is a separate choice. This setup uses Antigravity CLI for
Gemini sessions. Danus and Pharos are written for Codex. Check
existing integrations before adapting either system for Claude or Gemini, and
test the resulting configuration. Identify the accounts and supported models
available to this user before configuring the research backends.

## Folder layout

Use these paths in the environment where the research agents actually run:

```text
~/work/
  passel/       Passel source
  pharos/       https://github.com/frenzymath/Pharos
  danus/        https://github.com/frenzymath/Danus
  SETUP_NOTES.md
```

Create the Passel folder as needed. Once Passel is available in the browser,
direct the user to Settings → Setup to choose Install Danus, Install Pharos or
both. These buttons clone the current repositories into the lower-case paths
above; they do not install dependencies or configure research agents. Leave the
choice to the user, then complete setup for the selected projects. If the user
explicitly requests command-line installation instead, clone only their chosen
repositories into these paths. Inspect and reuse existing checkouts where
appropriate, preserving local changes, project data and active research sessions.
Record the selected projects, branches and commit IDs in `~/work/SETUP_NOTES.md`.

Use separate dependency environments for Pharos and Danus. Their wrappers and
configuration may expose a command named `codex`; keep these local to the
corresponding project rather than replacing the user's general Codex executable.
Store credentials and generated runtime data outside committed source.

The container sets `PASSEL_STATE_DIR` to `/home/passel/containers/passel` for its
private state and migrates the older directory when upgrading. Native observer
services retain `~/containers/herdr-web` when that variable is unset; consult
their code and documentation before choosing mounts or service working
directories. Cloning Passel into `~/work/passel` does not change runtime paths.

## Laptop setup

The full conversation observer and production file service target Linux. A native
macOS terminal/bridge build is not evidence that the complete workspace works.

- On Linux, use the intended user's local account.
- On Windows, use a Linux environment in WSL 2.
- On macOS, arrange a suitable Linux VM or container environment. Use an existing
  one if available; if the user must install or open a desktop application, give
  them the exact next step and continue once it is ready.

Keep Herdr, the research agents and their conversation observer together in a
Linux environment where the observer can validate the real processes and owned
transcripts. An unrelated web container cannot observe agents on the Mac host.
If source folders are mounted from the laptop, document both the host paths and
the paths inside Linux, and keep project and transcript paths stable.

Bind browser access to loopback and arrange any necessary VM/container forwarding
to the laptop. Prefer `http://127.0.0.1:8787`, choosing another free port if needed.
Tell the user which Linux environment must remain running and how laptop sleep
affects their work.

## Server setup

Run the installation on the server as the intended research user. The user's
laptop need not run Antigravity CLI, Claude Code, Codex or the research repositories
in this mode.

Start with loopback-only access through SSH. Prefer a single browser gateway on
server port 8787, using separate free internal ports for its services. If that
port is occupied, preserve the existing service and give the user an adjusted
command. The basic laptop-side tunnel is:

```sh
ssh -N -L 8787:127.0.0.1:8787 YOUR_USERNAME@YOUR_SERVER_ADDRESS
```

Supervise the supporting services and keep research sessions alive after browser
or SSH disconnection. Configure user-service persistence where necessary and
verify it. Explain recovery after a server reboot separately: restoring a
terminal layout does not itself restart an interrupted research problem.

For a group, provision a separate Linux user, Herdr session, Passel instance,
credentials, project files, caches and service state per member. Avoid port and
socket conflicts. Keep one person's transcripts and account tokens inaccessible
to another person's web instance.

If the user requests domain-based access, follow the README's suggested
Pangolin/Traefik and Pocket ID deployment, using the projects' current official
installation and integration documentation. Configure HTTPS, the identity
provider and per-instance access rules; check the relevant licence requirements
for an institutional deployment. The administrator supplies DNS/account access,
and each member enrols their own passkey. Keep direct bridge/file-service access
private so that authentication cannot be bypassed.

## Install and connect Passel

Read these references before assembling the deployment:

- [README.md](README.md): current dependencies, commands and supported protocols.
- [web/README.md](web/README.md): frontend routes and service integration.
- [conversation-service/README.md](conversation-service/README.md): observer,
  session ownership, private caches and replies.
- [docs/danus-output-browser.md](docs/danus-output-browser.md): file roots,
  gateway token, allowed origin and upload configuration.
- [docs/usage-counter.md](docs/usage-counter.md): optional usage collection.
- [docs/packaging.md](docs/packaging.md): building or using a desktop bundle.

Install the required Git/build tools, ripgrep (`rg`), Node.js 22.12+ with npm,
Rust stable and Python 3.11+ as appropriate to the host. A supported Node LTS
release is preferable.
Use the repository's lockfiles and documented build commands.

Install the original [Herdr TUI](https://herdr.dev/tui/), which this bridge uses,
and start the intended user's session. Check the daemon's reported protocol
against this checkout's compatibility checks; the README currently lists
protocols 20 and 22. The newer Herdr desktop app and `herdr-core` are a separate
runtime. Do not bypass compatibility rejection to attach an unsupported daemon.

Build the frontend and bridge, then configure the conversation observer and file
service, with usage collection if requested. A bridge-only installation provides
terminal access; it does not satisfy the full conversation/file/PDF setup.
The repository includes a per-user [Docker Compose build](docs/docker.md) with
all components and a pinned Herdr runtime in one container. Reuse it for a fresh
container installation. The user can install or update Claude Code, Codex and
Antigravity CLI (`agy`, for Gemini) through Settings → Setup, then complete sign-in
in a new Shell session. `docker compose exec passel bash` remains available for
manual setup and authentication. The whole user home persists in
one volume. Native or existing shared-host deployments still need their service
wiring reviewed separately.

In the single-container setup all components share one trusted user's filesystem
and process namespace. Keep credentials out of browsable project files, configure
the exact browser origin and expose only the browser gateway. In deployments
that split the services, use read-only project/cache mounts and keep the full
home, raw transcripts and credentials out of web-facing containers.

For Claude, Codex and Gemini, Terminal mode can provide access to their CLI
sessions; the current conversation observer supports Claude and Codex only. Do not
report Gemini Conversation mode as working without implementing and verifying
that integration. Install Antigravity CLI for Gemini sessions and verify
`agy --version`; the example Gemini launcher preset already runs `agy`.
Use Google's native installer and current authentication instructions linked
below. Over SSH, `agy` provides an authorization URL for the user to open in
their local browser and a prompt for the returned code.

Install each agent with its complete supported CLI package. Copying only a Codex
native executable can leave required daemon/package files behind and prevent
session resume. For automatic resume from an archived tab, use a normal
interactive shell prompt such as `user@host:path$` (or `%` / `>` formatting).
A minimal bare `$` prompt cannot be confirmed as idle by the current safety
check; resume manually in Terminal instead.

## Configure the selected research projects

For each selected checkout, read its current README, getting-started guide, agent
instructions and dependency declarations. Inspect bootstrap scripts before using
them and follow the documented setup for that branch. In particular:

1. Install its required packages into its own environment, including the gateway
   and verifier dependencies used by that version.
2. Install the documented browser/rendering and TeX tools needed for reports and
   PDF writeups. Verify a small document can be compiled and displayed.
3. Create local configuration from upstream examples without overwriting existing
   settings. Use models supported by the user's chosen backend and account.
4. Have the user complete required sign-ins, including inside the Linux runtime
   if the research agents run there. Keep tokens private and avoid printing them.
5. Configure the required verifier and other services without port conflicts,
   and run the upstream health checks. Establish whether a check sends a live
   model request and keep any such installation check small.
6. Connect the actual project/output directories to Passel's restricted file
   service, according to this checkout's documentation and the upstream layout.

Do not hard-code old bootstrap commands or dependency pins merely because they
worked on another checkout. Resolve version-specific failures in the relevant
project environment and record the resolution.

If the user wants Claude or Gemini for research, first check upstream branches and
supported integrations. Danus documents a Claude-orchestrator variant, but that does not
mean its workers and verifier also use Claude. Explain the actual configuration.
Prefer existing supported integration over writing a new adapter. If a requested
role needs code changes, identify that work and verify it explicitly; changing a
command name or the installer assistant is not a backend conversion.

## Verify the user-facing result

Use disposable test sessions and sample files, preserving any existing research.
Verify the following before reporting the corresponding feature as ready:

- Passel loads at the exact browser address given to the user, including through
  their SSH tunnel or authenticated domain when that mode is configured.
- Terminal mode connects to the intended Herdr session, and conversation mode
  reads the correct user's Codex/Claude session with rendered mathematics.
- A small user reply reaches the intended test session and appears in its saved
  conversation; merely displaying an old transcript is insufficient.
- The selected project directories appear in Files with their permitted outputs.
  A sample Markdown file renders and a sample PDF opens through the real file service.
- The selected projects pass their appropriate setup checks. Distinguish a service
  health check from a successful live model call; report any missing account or
  unsupported backend as unfinished work.
- In server mode, the services remain available after an SSH connection closes.
  For domain-based access, a signed-out browser cannot reach protected instances
  and a member cannot reach another member's instance without an explicit grant.

Run the repository checks appropriate to anything you changed; follow AGENTS.md
before committing or releasing. Do not start unattended research as part of
installation. Stop any temporary model sessions used only for installation
checks, while leaving the agreed services ready for the user.

## Hand over in plain language

Write `~/work/SETUP_NOTES.md` outside the repositories, without secrets, containing:

- The installed paths, versions/commits, Linux environment and selected backends.
- The browser URL and the exact laptop-side SSH tunnel command, if needed.
- How to start, stop, reconnect and recover the services, including after reboot.
- Where project files and writeups are saved, and how to back up persistent data.
- Which checks passed and what, if anything, still needs the user's action.

Finish by telling the user how to open Passel, where to start a Pharos or Danus
conversation, and how to give the first problem. Explain the distinction between
closing the browser, disconnecting SSH and stopping the research agents.

## Current upstream references

- [Antigravity CLI installation](https://antigravity.google/docs/getting-started?tab=cli)
- [Antigravity CLI authentication, including SSH sign-in](https://antigravity.google/docs/install?tab=cli)
- [Claude Code installation and sign-in](https://code.claude.com/docs/en/quickstart)
- [Codex CLI, official OpenAI documentation](https://learn.chatgpt.com/docs/codex/cli)
- [Codex sign-in, including device-code login](https://learn.chatgpt.com/docs/auth?surface=cli)
- [Pharos](https://github.com/frenzymath/Pharos)
- [Danus](https://github.com/frenzymath/Danus)

The human-facing CLI installation commands were checked against the official
documentation on 3 November 2026. Recheck upstream instructions when installing.
