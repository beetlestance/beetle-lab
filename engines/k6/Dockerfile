ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
ARG K6_IMAGE=grafana/k6:2.2.0@sha256:9bd01d6941fca969cb61bb57d2da5ee9b385fe2aa8881df3798c196564d6ace6

FROM scratch AS workspace-manifests
COPY package.json package-lock.json /
COPY app/package.json /app/package.json
COPY agent/package.json /agent/package.json
COPY contracts/package.json /contracts/package.json
COPY web/package.json /web/package.json
COPY engines/k6/package.json /engines/k6/package.json

# Build-host dependencies stay here; only bundle/source files cross platforms.
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS bundle
WORKDIR /build
COPY --from=workspace-manifests / ./
RUN npm ci --ignore-scripts --include=optional
COPY tsconfig.base.json tsconfig.node.json ./
COPY tools/build-k6.ts ./tools/build-k6.ts
COPY contracts/src ./contracts/src
COPY contracts/engines ./contracts/engines
COPY engines/k6/bootstrap ./engines/k6/bootstrap
COPY engines/k6/build ./engines/k6/build
COPY engines/k6/compiler ./engines/k6/compiler
COPY engines/k6/aggregation ./engines/k6/aggregation
COPY engines/k6/plan ./engines/k6/plan
COPY engines/k6/runtime ./engines/k6/runtime
COPY engines/k6/wrapper ./engines/k6/wrapper
RUN npm run build:k6

# Default FROM platform is TARGETPLATFORM, including npm's optional binary choice.
FROM ${NODE_IMAGE} AS production-deps
WORKDIR /beetle
COPY --from=workspace-manifests / ./
RUN npm ci --omit=dev --ignore-scripts --include=optional \
    --workspace=@beetle/engine-k6 --workspace=@beetle/contracts --include-workspace-root=false
RUN node -e "if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required'); if (require('esbuild').version !== '0.28.2') throw new Error('esbuild version'); const resolve = require('node:module').createRequire(require.resolve('esbuild')); resolve.resolve('@esbuild/linux-' + process.arch + '/bin/esbuild');"

FROM ${K6_IMAGE} AS native-k6

FROM ${NODE_IMAGE} AS engine
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision=$VCS_REF
WORKDIR /beetle
ENV NODE_ENV=production BEETLE_K6_LIVE_METRICS_V1=1
COPY --from=native-k6 /usr/bin/k6 /usr/local/bin/k6
COPY --from=production-deps /beetle/node_modules ./node_modules
COPY --from=production-deps /beetle/package.json ./package.json
COPY --from=production-deps /beetle/engines/k6 ./engines/k6
COPY --from=production-deps /beetle/contracts ./contracts
COPY --from=bundle /build/contracts/src ./contracts/src
COPY --from=bundle /build/engines/k6/dist/bootstrap ./bootstrap
COPY --from=bundle /build/engines/k6/dist/runtime ./runtime
COPY --from=bundle /build/engines/k6/dist/plan ./plan
COPY LICENSE ./LICENSE
RUN mkdir -p input secrets output image \
    && printf '{}\n' > image/empty.json \
    && chmod 0444 image/empty.json \
    && chmod 0555 image \
    && chown 1000:1000 input secrets output \
    && chmod 0500 input secrets \
    && chmod 0700 output
USER 1000:1000
HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/beetle/bootstrap/main.js"]
CMD []
