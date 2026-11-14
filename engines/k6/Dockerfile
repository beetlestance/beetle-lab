ARG NODE_IMAGE=node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ARG K6_IMAGE=grafana/k6:2.4.0@sha256:d41bb79cd8de5a7ad619b53570e3712633e8bff0937010a5c6c57a4747e7a276

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
COPY engines/k6/export ./engines/k6/export
COPY engines/k6/compiler ./engines/k6/compiler
COPY engines/k6/aggregation ./engines/k6/aggregation
COPY engines/k6/plan ./engines/k6/plan
COPY engines/k6/runtime ./engines/k6/runtime
COPY engines/k6/wrapper ./engines/k6/wrapper
COPY engines/k6/report ./engines/k6/report
RUN npm run build:k6

# Default FROM platform is TARGETPLATFORM, including npm's optional binary choice.
FROM ${NODE_IMAGE} AS production-deps
WORKDIR /beetle
COPY --from=workspace-manifests / ./
RUN npm ci --omit=dev --ignore-scripts --include=optional \
    --workspace=@beetle/engine-k6 --workspace=@beetle/contracts --include-workspace-root=false
RUN node -e "if (process.versions.node.split('.')[0] !== '24') throw new Error('Node 24 required'); if (require('esbuild').version !== '0.28.2') throw new Error('esbuild version'); const resolve = require('node:module').createRequire(require.resolve('esbuild')); resolve.resolve('@esbuild/linux-' + process.arch + '/bin/esbuild');"

FROM ${K6_IMAGE} AS native-k6

FROM ${NODE_IMAGE} AS engine-base
# Runtime uses bundled code and installed engine dependencies, never package managers.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT AND AGPL-3.0" \
      org.opencontainers.image.revision=$VCS_REF
WORKDIR /beetle
ENV NODE_ENV=production
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
COPY engines/k6/licenses /usr/share/licenses/k6
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

FROM engine-base AS export-engine
ENTRYPOINT ["node", "/beetle/bootstrap/export-main.js"]

FROM engine-base AS engine
ENV BEETLE_K6_LIVE_METRICS_V1=1
