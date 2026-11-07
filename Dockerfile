# syntax=docker/dockerfile:1.6
#
# beetle-lab container image.
# Pull the k6 binary from the official multi-arch image, then run the Express
# server on slim Node.js. Bucket data lives in a volume at /app/configs so it
# survives image upgrades.
#
# Build (your host arch):
#   docker build -t beetle-lab:1.1 .
#
# Build for a specific target platform (e.g. amd64 colleagues from an M-series Mac):
#   docker buildx build --platform linux/amd64 -t beetle-lab:1.1 --load .
#
# Run:
#   docker run --rm -p 4567:4567 -v $PWD/configs:/app/configs beetle-lab:1.1
#   open http://localhost:4567
#
# Share offline (no registry):
#   docker save beetle-lab:1.1 | gzip > beetle-lab-1.1.tgz
#   # recipient:
#   gunzip -c beetle-lab-1.1.tgz | docker load
#

ARG K6_VERSION=1.5.0
ARG NODE_VERSION=24

FROM grafana/k6:${K6_VERSION} AS k6

FROM node:${NODE_VERSION}-alpine

# k6 binary (matches the image's target platform via the multi-arch manifest).
COPY --from=k6 /usr/bin/k6 /usr/local/bin/k6

# tini gives us a proper PID 1 so SIGINT / SIGTERM propagate to k6 children.
RUN apk add --no-cache tini

LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install production dependencies first so they cache across source changes.
COPY package.json package-lock.json LICENSE ./
RUN npm ci --omit=dev --workspaces=false && npm cache clean --force

# App source. Listing files explicitly avoids dragging in dev artifacts even
# if .dockerignore is misconfigured.
COPY loadtest.js runner.js server.js ./
COPY public ./public

# Bucket data — configs, payloads, and run history. Persist via a volume.
RUN mkdir -p /app/configs && touch /app/configs/.gitkeep
VOLUME ["/app/configs"]

EXPOSE 4567
ENV PORT=4567 NODE_ENV=production

# Cheap liveness check against the folders endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:4567/api/folders >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
