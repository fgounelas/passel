# Third-party material

Passel's own MIT licence does not replace the licences of bundled components.
`THIRD_PARTY_NOTICES.txt` contains the actual upstream copyright, licence and
attribution texts. `inventory.json` records the reviewed versions, notice hashes
and the input hashes used to generate it. Upstream authors' names and copyright
contacts in these notices are intentional attribution.

## Fonts and browser assets

| Material | Notice and source |
| --- | --- |
| JetBrains Mono 2.304, patched by Nerd Fonts 3.4.0 | The original OFL in `web/public/fonts/OFL.txt`, Nerd Fonts notices, individual glyph-source attribution and icon licences in `licenses/`. The existing WOFF2 was inspected; the font has not been modified. |
| Geist variable font | OFL-1.1, including the Geist copyright, from the locked `@fontsource-variable/geist` package. |
| KaTeX fonts | OFL-1.1 with the Design Science and Khan Academy copyright and each reserved font name, preserved in `licenses/katex-fonts-LICENSE.txt`. KaTeX JavaScript has a separate MIT licence. |
| PDF.js Foxit fallback fonts | The PDFium/Foxit BSD notice in `pdfjs-dist/standard_fonts/LICENSE_FOXIT`. |
| PDF.js Liberation Sans 1.07.4 fallback fonts | GPL v2 with the Liberation font exception, exactly as supplied in `pdfjs-dist/standard_fonts/LICENSE_LIBERATION`. The unmodified matching source release is downloaded with SHA-256 verification into `web/public/pdf-assets/source/` and accompanies web builds. |
| PDF.js CMaps and optional decoder notices | Preserved from the exact locked `pdfjs-dist` package. Some optional decoder files are not part of the current web build. |
| Ghostty VT WebAssembly | `ghostty-web` MIT notice plus the pinned Ghostty, Zig and Unicode-support copyright/licence notices. |
| Rust standard library | Rust 1.99.1's MIT/Apache notices and its detailed standard-library copyright collection. Recheck these when changing the build toolchain. |

The fonts retain their own terms; they are not relicensed under Passel's MIT
licence. The patched terminal font includes icons and logos whose names and marks
remain those of their respective owners; attribution does not imply endorsement.

The PDF.js [font documentation](https://github.com/mozilla/pdf.js/blob/v6.3.289/external/standard_fonts/README.md)
identifies its exact Liberation version and warns that font glyph ordering is tied
to its rendering tables. The matching upstream source is mirrored by
[Debian](https://deb.debian.org/debian/pool/main/f/fonts-liberation/).
`assets.json` records the source URL and SHA-256. Builds retain the existing font
files and tables. They ship the complete corresponding source archive, including
its FontForge sources, build instructions and original licence files, at
`/pdf-assets/source/liberation-fonts-1.07.4.tar.gz`.

Rust's standard-library HTML copyright collection is converted to plain text,
retaining its legal text. Other collected licence files keep their original terms.
`provenance.json` records the URLs and hashes of supplemental notices missing from
published npm/Cargo packages. The generated glyph and KaTeX attribution files
also preserve the fonts' embedded copyright and licence metadata.

## Scope

The inventory covers production npm packages used by the web application,
excluding PDF.js's Node-only native canvas backend, and registry packages in
both Cargo lockfiles, including target-specific and build dependencies. It is
deliberately broader than the code linked into any one platform binary.
OR-licensed crates whose packages omit licence files have a permitted upstream
MIT notice supplied explicitly; other supplied alternatives are retained where
available. Review new licence expressions and bundled non-code assets on updates.

The source repository also retains Passel's `LICENSE`, root `NOTICE.md` and the
Herdr compatibility crate's Apache/MIT notices. Desktop bundles and web assets
include the collected notices.

Compose additionally builds Herdr 0.8.2 from a pinned, checksum-verified source
archive. Its image includes Herdr's Apache licence and a separately generated
notice inventory for the active Linux Cargo graph and patched local crate. The
main inventory also retains the native terminal library's Ghostty, Zig, uucode,
Highway and simdutf notices (the bundled simdutf header identifies version 9.0.0).
Official
base-image and operating-system notices remain in those images. Agent CLIs,
Pharos and Danus are installed separately and retain their own terms.

This collection records distribution notices; it is not a certification that all
possible deployments or third-party integrations satisfy their licence terms.

## Update and check

After changing a dependency or font, install from the lockfile, inspect its actual
licence files and non-code assets, and update supplemental notices if needed:

```sh
npm ci --prefix web
python3 scripts/third-party-notices.py generate
python3 scripts/third-party-notices.py check
```

Generation downloads Cargo archives and verifies each checksum against its
lockfile. It caches public archives in the system temporary directory; it does
not read credentials or publish anything. Review the resulting inventory and
texts before committing them. Checking is offline. Web builds reject stale
inputs, copy the reviewed notices to `/notices/`, and fetch the verified font
source only when an intact local copy is absent. Include those generated assets
in any separately assembled frontend distribution.
