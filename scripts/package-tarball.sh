#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: scripts/package-tarball.sh VERSION [PLATFORM]" >&2
  echo "example: scripts/package-tarball.sh v0.1.0 linux-x86_64" >&2
  exit 2
fi

VERSION="$1"
PLATFORM="${2:-}"

if [[ -z "$PLATFORM" ]]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os:$arch" in
    linux:x86_64) PLATFORM="linux-x86_64" ;;
    darwin:arm64) PLATFORM="macos-arm64" ;;
    darwin:x86_64) PLATFORM="macos-x86_64" ;;
    *)
      echo "cannot infer platform for $os/$arch; pass PLATFORM explicitly" >&2
      exit 2
      ;;
  esac
fi

PKG_ROOT="$ROOT/dist-packages"
NAME="passel-${VERSION}-${PLATFORM}"
STAGE="$PKG_ROOT/$NAME"
ARCHIVE="$PKG_ROOT/$NAME.tar.gz"

npm --prefix "$ROOT" run build:web
cargo build --release --manifest-path "$ROOT/bridge/Cargo.toml" --bin passel-bridge

rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE/bin" "$STAGE/share/passel/web" "$STAGE/vendor/herdr-compat" "$STAGE/third-party"

cp "$ROOT/bridge/target/release/passel-bridge" "$STAGE/bin/passel-bridge"
cp -R "$ROOT/web/dist/." "$STAGE/share/passel/web/"
cp "$ROOT/docs/tarball-readme.md" "$STAGE/README.md"
cp "$ROOT/LICENSE" "$STAGE/LICENSE"
cp "$ROOT/NOTICE.md" "$STAGE/NOTICE.md"
cp "$ROOT/SECURITY.md" "$ROOT/THIRD_PARTY_NOTICES.txt" "$STAGE/"
cp "$ROOT/third-party/README.md" "$ROOT/third-party/inventory.json" "$STAGE/third-party/"
for notice in LICENSE-APACHE LICENSE-MIT NOTICE.md; do
  cp "$ROOT/vendor/herdr-compat/$notice" "$STAGE/vendor/herdr-compat/$notice"
done

cat > "$STAGE/bin/passel" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$BIN_DIR/.." && pwd)"

exec "$BIN_DIR/passel-bridge" --static-dir "$ROOT/share/passel/web" "$@"
WRAPPER
chmod +x "$STAGE/bin/passel" "$STAGE/bin/passel-bridge"

(
  cd "$PKG_ROOT"
  COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" "$NAME"
  if command -v sha256sum >/dev/null; then
    sha256sum "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  elif command -v shasum >/dev/null; then
    shasum -a 256 "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"
  else
    echo "warning: no sha256 tool found; checksum not written" >&2
  fi
)

echo "$ARCHIVE"
