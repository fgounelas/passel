# Conversation service

A Linux observer running as the owner of a Herdr session. It binds a pane to an
owned Codex/Claude transcript using process identity and explicit session metadata;
it does not choose conversations by recency or title alone.

## Runtime

Run `collector.py` with Python 3.11+ as the session owner. Set
`HERDR_CONVERSATION_SESSION` to the intended session (`work` or `default`).
The container uses `PASSEL_STATE_DIR=/home/passel/containers/passel`. Native
installations retain `~/containers/herdr-web` when that variable is unset.
The private-state directory contains:

- `conversation-cache/`: disposable sanitized messages and a local reply socket.
- `conversation-state/`: persistent bookmarks, archive state and reset receipts.

Keep directories private. In a split deployment, mount only the normalized cache
into the file service, read-only, and keep the full home and credentials out of
the web container. The Compose default supervises all components as one trusted
user inside a single container. A native deployment may use a user service or
an existing cron heartbeat; it must not restart agent sessions during updates.

## Behaviour

- Show canonical human and assistant messages, including commentary and final answers.
- Include Claude's explicitly marked visible progress updates, even when their
  text is stored in a thinking block (`thinkingDisplay: updates`).
- Exclude tool output, reasoning, injected context and worker notifications.
- Preserve confirmed Claude instructions delivered during an active turn and
  validated continuation chains without copying duplicated history.
- Retain bounded recent messages; history/search read bounded portions of the
  original transcript independently of terminal scrollback.
- Keep transient working-command previews separate from permanent messages.
- Save pins on the server and navigate to the original message when selected.

Recent history is capped at 300 messages/500,000 characters, each message at
64,000 characters. History requests scan at most 16 MiB and return at most
40 messages/500,000 characters. Browser reading windows have their own smaller
bounds. Original transcripts remain the source of truth.

## Replies and actions

The private Unix service revalidates pane, session, foreground process and any
waiting question before accepting a user action. Browser access goes through the
file service's gateway, exact-Origin and custom-header checks. Replies send one
literal submission and are never retried automatically. Input queuing is distinct
from a confirmed saved user record.

Archive hides a tab. Optional graceful quit exits that tab's supported agent;
it does not guarantee that independent workers have stopped. Restore never
implicitly resumes a session. Provider quota resets require separate explicit
confirmation and a persisted idempotency key.

## Tests

```sh
python3 -m unittest discover -s conversation-service -v
```

Tests use synthetic messages, accounts and process fixtures. Run process-lifecycle
integration checks only in disposable sessions, never against a live research task.
