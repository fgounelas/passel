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

The UI shows actual provider windows, reset times and freshness. Missing data is
not zero. Credits and banked resets appear only when the provider reports them.
Redeeming a reset requires an explicit account-labelled confirmation, server
revalidation and a persisted idempotency key; retries reuse that same attempt.
Nothing resumes a worker or consumes a reset automatically.

```sh
python3 -m unittest discover -s usage-service -v
```

Integration tests should use disposable agent profiles. Never print credentials
or use a real quota reset as a smoke test.
