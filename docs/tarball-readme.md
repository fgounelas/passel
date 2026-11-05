# Passel Desktop Bundle

This bundle contains the Passel browser UI assets and the `passel-bridge` executable.

It does not include Herdr itself. Start or attach a compatible session before
running this bundle: Herdr `v0.8.2+` with terminal protocol `20`, or Herdr
`v0.9.3+` with protocol `22`.

Licences and attribution are included in `LICENSE`, `NOTICE.md`, and
`vendor/herdr-compat/`. The Herdr-derived compatibility code retains its
Apache-2.0 licence; the application and local compatibility changes retain their
MIT licence.

## Run

From the unpacked bundle directory:

```bash
bin/passel
```

Open:

```text
http://127.0.0.1:8787
```

## Access From Another Browser

For browser-served multi-bridge use, configure both directions. The bridge being called must allow
the web page origin with `--allow-origin`; the bridge serving the web page must allow that page to
connect out with `--allow-connect-origin`. For example, a page opened from `http://host-a:8787` that
connects to `http://host-b:8787` needs:

```bash
# host A, serving the web page
bin/passel --host 0.0.0.0 --allow-host host-a --allow-connect-origin http://host-b:8787

# host B, serving the backend being called
bin/passel --host 0.0.0.0 --allow-host host-b --allow-origin http://host-a:8787
```

Only bind to non-loopback interfaces on networks you trust.
