# Phase 1 adapter image.
#
# Single-stage on purpose: this is a dev/internal-pilot artifact, not a
# slim production image. A multi-stage build with tsc-compiled output
# is Phase 2 work.
#
# Why bookworm-slim and not alpine: @cursor/sdk@1.0.7 pulls in native
# bindings (better-sqlite3 in our case, plus the bundled cursor-agent
# runtime the SDK uses internally). Debian/glibc is the path of least
# surprise; alpine/musl has historically required extra rebuild steps.
FROM node:22-bookworm-slim

# Ripgrep is a hard runtime dependency of @cursor/sdk@1.0.7 — the SDK
# resolves `rg` via `which` on startup and crashes the agent's tool
# loop with "Ripgrep path not configured" otherwise. Installing it
# system-wide makes our PATH workaround in src/cursor/runtime.ts
# redundant inside the container (it stays for host-mode dev).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps. We install via `npm install` (not `ci`) because the
# lockfile may not be checked in / fresh in dev; switch to `npm ci`
# once the lockfile is stable. NODE_ENV=production at runtime, but we
# install all deps (no --omit=dev) because we ship TypeScript and run
# it via tsx — tsx is a runtime dep here, not a build dep.
COPY package.json package-lock.json* ./
RUN npm install

# Application source. Tests are deliberately NOT copied — the
# container should not have access to test markers, that's the
# isolation point.
COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    ADAPTER_HOST=0.0.0.0 \
    ADAPTER_PORT=8080 \
    WORKSPACES_DIR=/app/workspaces \
    ADAPTER_STATE_DIR=/app/.run/adapter

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

# No --env-file flag here — compose injects env via `env_file:` and
# `environment:` directives in docker-compose.yml.
CMD ["npx", "tsx", "src/index.ts"]
