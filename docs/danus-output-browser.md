# Files and documents

Files displays an expandable `~/work` tree. Click a file to open the document
viewer; right-click a file or folder for **Copy full path**. Files also offer
Download. Keyboard users can open the same menu with Shift+F10.

Filename search includes unopened visible folders. Listings refresh while Files
is visible. The sidebar and document viewer can collapse independently.

## Scope

Ordinary top-level work folders retain their structure and regular files. Names
containing `danus`, `pharos` or `rethlas` use configured, filtered project-output
views. Dotfiles, symlinks and special files are excluded. Work-root loose files
are not listed.

Workflow views expose approved paper, fact, report, note, plan and audit folders,
including `fact_graph/facts`, root `PROBLEM.md` and dated run records. Configured
Pharos views also include reports, checkpoints, materials, guidance and `ROUTES.md`.
Workflow credentials and unrelated runtime state stay excluded.

PDF uses bundled PDF.js with bounded canvas rendering. Markdown supports GFM and
KaTeX without raw HTML or remote image loading. TeX shows complete source and can
open a matching PDF. Known code/data formats show escaped source; unknown formats
are download-only. The viewer never compiles or executes uploaded content.

Cmd/Ctrl+A and native Select All stay within the active text document. Partial
selection and copying remain native. PDF expansion fills the browser viewport.

## Optional service

`files-service/server.py` is a Python standard-library HTTP service. Configuration:

| Variable | Purpose |
| --- | --- |
| `HERDR_OUTPUT_ROOTS` | JSON map of workflow names to mounted project directories |
| `HERDR_WORK_DIR` | Optional read-only work directory mount |
| `HERDR_WORK_HOST_DIR` | Display-only absolute host work path for Copy full path |
| `HERDR_DANUS_UPLOAD_DIR` | Optional writable upload inbox |
| `HERDR_OUTPUT_ORIGIN` | Exact browser origin; defaults to local loopback |
| `HERDR_GATEWAY_TOKEN_FILE` | Private token file; defaults to `/run/herdr-web/gateway-token` |
| `HERDR_CONVERSATION_CACHE` | Normalized cache and private reply socket; defaults to `/conversation` |
| `HERDR_USAGE_CACHE` | Normalized usage JSON; defaults to `/usage/status.json` |

Read the gateway token from the retained legacy path `/run/herdr-web/gateway-token`, supplied separately
from source control. Keep the service on loopback in the gateway's network
namespace and proxy `/api/project-files/` through an authenticated HTTPS gateway.
The gateway must preserve the private header and restrict mutation methods to
the exact upload/reply/action routes. The file service adds no public listener.

In split deployments, mount project/work paths and normalized caches read-only;
only the upload inbox needs writes. The single-container Compose setup uses
paths within its shared user home instead; the file API's path restrictions
remain in force. See [the Compose trust boundary](docker.md#access-and-trust).

## Uploads

Uploads always enter the shared work inbox. Accepted extensions are PDF, TeX,
Markdown, TXT, DjVu, BibTeX, Lean, CSV/JSON, PNG/JPEG, Python/Sage, notebooks and
LaTeX style/class files. Limits: 100 MB per file and a 1 GiB free-space reserve.
Text must be UTF-8 without NUL; binary formats have signature checks. These checks
are not a full file validator or malware scanner.

Uploads stream, never overwrite an existing file, and reject traversal/symlinks.
Only files in the upload inbox can be deleted, after explicit confirmation.
Search, listing and preview sizes are bounded; errors do not reveal filesystem
paths. No files are imported into an agent automatically.
