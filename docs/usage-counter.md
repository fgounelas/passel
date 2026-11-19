# Provider usage

The optional `usage-service/collector.py` runs as the session owner on Linux.
It reads supported provider-reported limits for that user's foreground agent
profiles and writes a bounded normalized cache. It does not send prompts.

Use `HERDR_QUOTA_SOCKET` to select a Herdr socket; otherwise the observer uses
its documented session defaults. Profile paths derive from the current user's
home. Keep credentials and CLI configuration with that user. In split deployments,
keep them outside the web container and mount only `usage-cache/` into the file
service, read-only. The Compose default shares one trusted user's home internally.

Codex collection uses the CLI app-server. Claude collection can use its usage
status hook; `usage-service/install.py` installs a per-user heartbeat and preserves
existing settings. Read the installer before running it: it modifies that user's
crontab and optionally adds a Claude hook.

The collector checks Codex usage about every five minutes. Claude Code supplies
subscription limits in its [status line](https://code.claude.com/docs/en/statusline)
after responses, so idle panes may hold older samples. The browser reads the
server cache every 30 seconds while visible. **Refresh** checks that same
cache immediately and reports whether a newer sample was available.

For standard Claude subscription panes, the observer reads the signed-in profile
email through `claude auth status`, at most once every five minutes. It leaves the
label generic when the pane can override authentication or the CLI cannot confirm
the default profile. The identity check does not request usage or send a prompt.

The UI shows actual provider allowance and marks stale readings. Missing data is
not zero. Claude links to its usage page for credits and resets. Codex can show
reported credit balances, reset times and banked resets.
Redeeming a reset requires an explicit account-labelled confirmation, server
revalidation and a persisted idempotency key; retries reuse that same attempt.
Nothing resumes a worker or consumes a reset automatically.

```sh
python3 -m unittest discover -s usage-service -v
```

Integration tests should use disposable agent profiles. Never print credentials
or use a real quota reset as a smoke test.
