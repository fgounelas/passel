# Security policy

Passel provides access to a user's terminal, research files and agent sessions.
Anyone who can use an instance should be trusted to act as that Linux user.
It is not a sandbox for running untrusted code or a shared multi-user service.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a vulnerability**
button on the [security advisories page](https://github.com/fgounelas/passel/security/advisories).
Include the affected commit or version, deployment method, expected impact and
minimal reproduction steps using synthetic data. Do not include account tokens,
private transcripts, research files or other people's personal information.

Private vulnerability reporting must be enabled when this repository becomes
public. While the repository is private, use an existing private channel to its
maintainer. If the private reporting button is unavailable after publication,
open an issue asking for a private contact method, without vulnerability details.

We will review reports and coordinate a fix and disclosure with the reporter.
There is no guaranteed response time or bug bounty.

## Supported versions

Before the first release, fixes target the current `main` branch. After a
release, use the latest release and review its changelog before upgrading.
Older releases do not have a separate security maintenance commitment.

## Deployment boundary

- Keep the bridge and supporting services private. The bridge has no browser
  login of its own. Origin/Host validation and private sidecar headers are not
  user authentication.
- The supplied Compose setup maps only a localhost port for a local browser or
  SSH tunnel. Remove that mapping when a proxy on its Docker network connects
  directly. Use authenticated HTTPS for domain access and
  keep each research instance on its own network to prevent bypassing the proxy.
- Use a separate Linux account or Compose project, credentials,
  persistent volumes and access rules for each research group member. Giving
  someone access to Docker itself usually gives them control of the host.
- The Compose default runs all components as one non-root user in one container,
  sharing that user's filesystem. It does not isolate web processes from the
  research user's credentials. Use one trusted user per instance and protect
  the entire browser gateway. The file API restricts served paths independently.
- Keep credentials out of browsable project files and upload inboxes. In custom
  deployments that separate the services, give web/file components only permitted
  project paths, normalized caches and required private sockets; use read-only
  project/cache mounts there.
- Uploaded files are untrusted input. Extension and size checks do not make
  them safe to execute. Review agent actions and approvals before submitting.
- Keep the OS, Docker, Herdr, agent CLIs and application dependencies updated.
  Check Herdr protocol compatibility before replacing its pinned container build.
- Back up persistent projects, notes and configuration securely; backups may
  also contain agent credentials and private research. Never commit them.

See [the Compose guide](docs/docker.md) and
[installation instructions](INSTALL_INSTRUCTIONS.md) for the runtime layout.
