# Preparing a source repository

A private repository still needs a privacy review. Ignore rules do not remove
already-tracked files or data from earlier commits. Do not push an operational
checkout's history when creating an independent source repository.

## Create a reviewed source snapshot

After changing reviewed source, refresh the checkout's manifest and include it
with the source changes:

```sh
npm run source:manifest
npm run source:check
```

The manifest command applies the exporter's allowlist and content checks to the
current files. It rejects PNG metadata that needs review instead of silently
hashing a different image. `--check` fails if the manifest is stale or missing.
When adding a source path outside the existing patterns, update
`source-release.json` too. CI checks that every tracked file is reviewed.

To create a separate clean snapshot:

```sh
python3 scripts/source-release.py export --output .release-prep/passel
python3 scripts/source-release.py audit .release-prep/passel
```

The exporter copies only `source-release.json`'s allowlisted files. It excludes
Git metadata, deployment directories, local configuration, state, transcripts,
backups, generated builds, dependencies and private screenshots. The reviewed
README images in `docs/screenshots/` are included. The exporter rejects symlinks
and secret-shaped content, removes optional PNG metadata, and records SHA-256
hashes in `SOURCE_MANIFEST.json`. It does not run Git, authenticate or contact a
server.

For an operational checkout, supply a local `.release-private-patterns.json`
with `patterns` entries containing `label` and regular-expression `regex` fields.
The exporter reads this file for additional private identifiers but never includes
it in the snapshot. Keep the list local and do not publish audit reports containing
private values. Audit output reports paths and categories, not matched values.

Review the snapshot and manifest, run its tests, then initialize a new local Git
repository there. Keep the original checkout as a private backup. Make the new
repository the canonical development copy once validated; keep machine-specific
configuration outside it. Retain `LICENSE` and `NOTICE.md`.

## Authenticate the intended GitHub account

Use an isolated GitHub CLI configuration so an unrelated saved login cannot be
used accidentally:

```sh
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$HOME/.config/gh-passel" gh auth login --hostname github.com --git-protocol https --web
env -u GH_TOKEN -u GITHUB_TOKEN GH_CONFIG_DIR="$HOME/.config/gh-passel" gh api user --jq .login
```

Verify the displayed login, repository owner, email visibility, and intended
private visibility before creating or pushing a repository. Set the new local
repository's author identity to that account's GitHub-provided noreply address
if the personal email should remain private. Do not copy Git config, remotes,
credentials, hooks or old refs from the operational checkout.

Creating a repository and publishing a release are separate actions. The existing
release script pushes commits/tags and creates a GitHub release; do not run it
merely to prepare or inspect a private source snapshot.
