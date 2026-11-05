# Passel web frontend

React + Vite frontend for Passel.

Read [the UI design guide](../docs/design.md) before changing layout, controls, or styling.

Run from this directory:

```bash
npm install
npm run dev
npm run lint
npm run test
npm run build
```

The production build is written to `web/dist/` and served by `passel-bridge` through
`scripts/run-bridge.sh`.

For the normal one-command development workflow, start the bridge and Vite from the repository root:

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` and `/ws` to the managed bridge and hot-reloads
frontend edits. See the root README for address and socket overrides.

To manage the two processes separately instead:

```bash
# terminal 1, from the repository root
npm run bridge:build && scripts/run-bridge.sh

# terminal 2, from the repository root
npm run dev:web
```

`scripts/run-bridge.sh` points debug bridge builds at the stable Herdr socket by default instead of
the debug `herdr-dev` socket. Override `HERDR_SOCKET_PATH` when targeting a named or development
session.

The app expects these bridge routes:

- `/api/capabilities`
- `/api/snapshot`
- `/api/command`
- `/api/launcher-presets`
- `/api/launcher-presets/launch`
- `/api/selection`
- `/api/notes` (and `/api/notes/{note_id}/...` actions)
- `/api/agent-pins` (and `/api/agent-pins/{pane_id}/pin|unpin`)
- `/api/agent-activity`
- `/api/uploads`
- `/ws/activity`
- `/ws/events`
- `/ws/ui-events`
- `/ws/terminal`

Launcher execution belongs to the bridge. The frontend selects a preset and placement; it does not
construct Herdr `agent.start` requests. Built-in agents use Herdr's managed-agent flow after the
bridge creates the destination pane, while custom presets retain their exact configured `argv`.

Passel's deployment preset file, `examples/launcher-presets.json`, lists Shell,
Claude, Codex and Gemini. The Gemini option launches Antigravity CLI (`agy`);
install it using [Google's instructions](https://antigravity.google/docs/getting-started?tab=cli).
Install that file as `${XDG_CONFIG_HOME}/herdr-web/launcher-presets.json` for the
bridge (the retained legacy configuration directory), then restart the paired
web/files containers to reload it. The web dialog
uses the server's list; it does not construct or substitute executable commands.

The optional same-origin Conversation view uses
`GET /api/project-files/conversation?pane=...` from the authenticated file sidecar.
It requires the per-user host observer described in
[conversation-service/README.md](../conversation-service/README.md). Unsupported
panes retain Terminal access; no transcript paths are accepted from the browser.

Conversation is the default view for same-origin panes. Terminal remains available
from the toolbar; existing shells and Codex processes are not stopped by switching
views. The split toolbar buttons are hidden, but existing splits still work.
Pinned messages are server-persisted, scoped by instance and conversation ID,
with a bounded right-hand list that works across browsers and logins. Message shortcuts append text for review before sending.
The folder action reveals the associated project, offering a scrollable chooser
if ambiguous. Choices persist in the browser per server/terminal/working directory
and are checked against the permitted folders. Right-click or long-press the
folder button to choose another project (Shift+F10 also works).

New shell and agent tabs save their launch names in Herdr as both tab and pane
labels. Renaming a single pane also renames its tab, keeping the terminal UI and
Passel names consistent.

Spaces and tabs can be dragged to reorder them. Small grip handles also support
pointer/touch dragging and arrow keys. Tab order is shared by the top bar and Tabs
sidebar and saved in Herdr; agent-priority groups retain precedence. Moves stay
within the current server and workspace. Space worktree families move together.
The `tab.move` capability is required for tab dragging; older bridges keep normal
selection and menus without exposing unsupported controls.

### Project setup and terminal directory

Settings → Setup also uses `GET/POST /api/project-files/setup/clis` for the
selected server's Claude Code, Codex and Antigravity CLI (`agy`) versions and
explicit install/update actions. Only the fixed CLI ID and `install`/`update`
action are posted. Installers run under the server user with a bounded runtime,
serialized filesystem lock and private logs. Account sign-in remains in Terminal;
no API keys or account configuration are accepted through this endpoint.

Settings → Setup uses the selected server's `GET/POST /api/project-files/setup`
endpoint. Explicit install actions clone only the allow-listed Danus/Pharos
repositories into `~/work/danus` and `~/work/pharos`, preserving existing files.
This requires the full file-service/gateway deployment. The source is cloned;
project dependencies and provider sign-ins remain separate installation steps.

Settings → Terminal saves a startup path on that server. Enter or blur applies
the path after validation; errors remain beside the field. The bridge reads the
private `terminal-startup.json` preference for new spaces, tabs, splits and
launcher presets without an explicit directory. It defaults to `~/work` and
never changes an existing pane's directory. Startup paths are passed as Herdr
parameters, never as shell input. Mutations require exact Origin, the private
gateway header and `X-Herdr-Setup: 1`.

### Appearance

Settings → Appearance offers ten themes and a live preview, plus conversation and
terminal fonts/sizes, background opacity, reading width/spacing, accent colour and
reduced motion. Preferences live on the browser/device, synchronise between its
same-origin tabs and apply without reconnecting a terminal. The old terminal font
size preference is retained. Theme changes affect UI and terminal default colours;
terminal applications can still specify their own colours.

Grid-aware terminal output negotiates `output_grid=true`. Binary tags 2/3 carry
raw/gzip records with little-endian columns, rows, full-snapshot flag and byte
length beside each ANSI payload. Legacy raw and gzip output remain compatible.
The browser projects the emitted grid into its viewport, applies full snapshots
in place and keeps incremental parser state. Herdr retains the actual history.

### Tab archives

The authenticated same-origin sidecar accepts POST
`/api/project-files/conversation/archives`, with the existing conversation origin
and request-marker checks. A private observer database at
`conversation-state/archives.sqlite` persists archives across browsers. Tabs stay
in Herdr; archive/restore does not reorder, close, or restart them. Other browsers
refresh archive metadata every ten seconds while visible.

Explicit Quit session and archive is limited to a single-pane tab with exactly one
validated same-user foreground Codex or Claude TUI. The observer tracks the PID lifetime using
Linux pidfd, clears an ordinary Codex draft with Escape/Ctrl-U/Ctrl-K editing keys, stages
`/quit` for Codex or `/exit` for Claude, verifies it is the only composer text,
submits it, and waits for exit
before archiving. Multiline drafts that fail read-back require manual clearing.
Ctrl-C is never used for this preparation: it can start a delayed exit. An exit
detected between stages stops further input and preserves resume metadata.
There is no forced-signal fallback.
It never kills a process group, daemon or worker. Restore does not restart Codex;
Resume is a separate action at the same idle shell, using server-captured executable,
working directory, agent kind, CODEX_HOME/CLAUDE_CONFIG_DIR and conversation UUID (or a fresh TUI for an empty
session without a transcript). No browser-provided paths, PIDs or commands are accepted.

Resume requires a recognised empty shell prompt before typing anything. It stages
and reads back the exact command before Enter, then verifies the expected foreground
Codex process has started before deleting saved launch metadata. Nonempty or custom
prompts fail closed with an instruction to clear the input or resume manually. It
never sends Ctrl-U to the shell (a previously killed TUI may leave Kitty mode active).

### Sessions and Codex choices

Sessions replaces the separate Agents/Tabs navigation with Current/Archived counts
and All sessions / Working / Needs attention filters. Archived groups span spaces
on the selected host. Whole-tab drag replaces visible handles; touch uses hold then
move, and keyboard users get a focus-visible reorder button.

The authenticated POST `/api/project-files/conversation/choice` previews at most
80 visible terminal lines (12 KB) every three seconds while the conversation is
visible. Inputs are restricted to Open (Alt+Up), Up, Down, Enter and Escape, bound
to a validated foreground Codex PID/start time. Enter additionally requires the
same displayed frame, and navigation requires an open question UI. No automatic
selection or input retry. An exact POST nginx location must accompany this route.

Claude command approvals also use this panel, including command context and
numbered buttons. Option clicks stage only bounded arrow navigation, then recheck
the exact process, command and selected option before one Enter. Codex-only Alt
controls are omitted. The reply composer is disabled while a choice is active.
Fresh owned Claude sessions are connected before their first transcript, and
missing provider quota is labelled Awaiting response rather than guessed.

The observer keeps an in-memory proven pane/PID/start/profile attachment during
question-induced caption/classification changes. It rechecks the original thread,
working directory and daemon-owned transcript; it never guesses another thread.
A process restarted while already blocked without a prior proven binding may
still need its normal title restored before first attachment.

Background history/bookmark requests and choice inspection do not acquire the
terminal-input lock. Actual controls remain serialized, with a bounded wait and
no retry, so question polling cannot reject a reply as a simultaneous send.

Claude lifecycle support uses the owned native `claude` process and approved
`~/.claude` profile, `/exit`, and `--resume UUID`. Composer checks recognise Claude's
nonbreaking space and horizontal borders using bounded visible-screen reads.
Unsupported agents keep Archive only; never guess an exit command or kill a process
as a fallback. Existing saved records without an agent kind remain Codex records.
Reference: https://code.claude.com/docs/en/interactive-mode and
https://code.claude.com/docs/en/cli-reference (also verified against installed CLI).

Native Claude resumes through a private, version-bound `claude` symlink under
`conversation-state/launchers` (at most 128 versions), validated against the saved
executable. This retains Herdr process detection and avoids following an upgraded
public launcher. Preserve whether CLAUDE_CONFIG_DIR was unset: explicitly setting
its default path changes Claude's onboarding/settings file location.

With Herdr 0.9.3, terminal WebSockets deliver `terminal_mouse_capture` with a boolean `enabled`,
including the current value for later viewers. The renderer forwards primary
mouse press/release and short stationary touch taps as structured cell-based
mouse events only while enabled. Shift selection, swipe scrolling and ordinary shell clicks stay local.
Mouse state survives full display resets and is cleared on disconnect.
