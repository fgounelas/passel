# syntax=docker/dockerfile:1.7

# Multi-architecture official image indices, reviewed 2026-11-03.
FROM rust:1-bookworm@sha256:9181b56c2a21ab1d5e73cffe04fc762426d30aa7fac3c91141dd033f49a7fc8b AS rust-build
RUN apt-get update && apt-get install --yes --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY bridge/ bridge/
COPY vendor/herdr-compat/ vendor/herdr-compat/
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo test --locked --manifest-path vendor/herdr-compat/Cargo.toml \
    && cargo test --locked --manifest-path bridge/Cargo.toml --bin passel-bridge \
    && cargo build --locked --release --manifest-path bridge/Cargo.toml --bin passel-bridge

# Herdr 0.8.2 / terminal protocol 20. Native installs still install Herdr separately.
# Keep this pin aligned with the bridge's reviewed protocol combinations.
ADD --checksum=sha256:0797b440181e1da1f43a32c4cfb2c8e11a4398b8c1f392ab5a43b0e748ab7577 \
    https://codeload.github.com/herdrdev/herdr/tar.gz/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c /tmp/herdr-source.tar.gz
RUN mkdir /build/herdr && tar -xzf /tmp/herdr-source.tar.gz --strip-components=1 -C /build/herdr
ARG TARGETARCH
# Herdr's vendored libghostty-vt requires Zig 0.15.2. The compiler stays in
# this build stage; verify the official architecture-specific release archive.
RUN apt-get update && apt-get install --yes --no-install-recommends curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
        amd64) zig_arch=x86_64; zig_sha=02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239 ;; \
        arm64) zig_arch=aarch64; zig_sha=958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f ;; \
        *) exit 1 ;; \
    esac \
    && curl --fail --silent --show-error --location \
        "https://ziglang.org/download/0.15.2/zig-${zig_arch}-linux-0.15.2.tar.xz" --output /tmp/zig.tar.xz \
    && echo "$zig_sha  /tmp/zig.tar.xz" | sha256sum --check --status \
    && mkdir /opt/zig \
    && tar -xJf /tmp/zig.tar.xz --strip-components=1 -C /opt/zig \
    && ln -s /opt/zig/zig /usr/local/bin/zig \
    && rm /tmp/zig.tar.xz
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --locked --release --manifest-path herdr/Cargo.toml --bin herdr
COPY scripts/third-party-notices.py scripts/third-party-notices.py
COPY third-party/ third-party/
RUN --mount=type=cache,target=/tmp/passel-third-party-cache \
    python3 scripts/third-party-notices.py cargo --cargo-source herdr --output /build/herdr-notices.txt

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS web-build
WORKDIR /build
COPY web/package.json web/package-lock.json web/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix web
COPY web/ web/
COPY scripts/copy-pdf-assets.mjs scripts/prepare-web-notices.mjs scripts/third-party-notices.py scripts/
COPY docker/Dockerfile docker/Dockerfile
COPY bridge/Cargo.lock bridge/Cargo.lock
COPY vendor/herdr-compat/Cargo.lock vendor/herdr-compat/Cargo.lock
COPY third-party/ third-party/
COPY LICENSE NOTICE.md THIRD_PARTY_NOTICES.txt ./
RUN npm run build --prefix web

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS passel
RUN apt-get update && apt-get install --yes --no-install-recommends \
    python3 python3-venv nginx tini ca-certificates curl git ripgrep procps util-linux libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && usermod --login passel --home /home/passel --move-home node \
    && groupmod --new-name passel node
ENV HOME=/home/passel SHELL=/bin/bash LANG=C.UTF-8 \
    PATH=/home/passel/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    NPM_CONFIG_PREFIX=/home/passel/.local \
    PASSEL_STATE_DIR=/home/passel/containers/passel \
    PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ARG PASSEL_REVISION=development
LABEL org.opencontainers.image.source="https://github.com/fgounelas/passel" \
    org.opencontainers.image.revision="${PASSEL_REVISION}"
COPY --from=rust-build /build/bridge/target/release/passel-bridge /usr/local/bin/passel-bridge
COPY --from=rust-build /build/herdr/target/release/herdr /usr/local/bin/herdr
COPY --from=rust-build /build/herdr/LICENSE /usr/share/doc/passel/herdr/LICENSE
COPY --from=rust-build /build/herdr-notices.txt /usr/share/doc/passel/herdr/THIRD_PARTY_NOTICES.txt
COPY --from=web-build /build/web/dist/ /opt/passel/web/
COPY conversation-service/ /opt/passel/conversation-service/
COPY usage-service/ /opt/passel/usage-service/
COPY files-service/ /opt/passel/files-service/
COPY examples/launcher-presets.json /opt/passel/launcher-presets.json
COPY docker/entrypoint.py docker/nginx.conf /opt/passel/docker/
COPY LICENSE NOTICE.md THIRD_PARTY_NOTICES.txt SECURITY.md /usr/share/doc/passel/
COPY third-party/README.md /usr/share/doc/passel/third-party/README.md
COPY vendor/herdr-compat/LICENSE-APACHE vendor/herdr-compat/LICENSE-MIT vendor/herdr-compat/NOTICE.md /usr/share/doc/passel/herdr-compat/
RUN mkdir -p /home/passel/work /home/passel/.config/herdr /home/passel/.local/share/passel \
    && chown -R 1000:1000 /home/passel
USER 1000:1000
WORKDIR /home/passel/work
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=5s --start-period=15s --retries=20 \
    CMD ["python3", "/opt/passel/docker/entrypoint.py", "health"]
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/opt/passel/docker/entrypoint.py"]
CMD ["serve"]
