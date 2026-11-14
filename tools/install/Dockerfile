ARG NODE_IMAGE=node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS bundle
WORKDIR /build
COPY package.json package-lock.json ./
COPY app/package.json ./app/package.json
COPY agent/package.json ./agent/package.json
COPY contracts/package.json ./contracts/package.json
COPY web/package.json ./web/package.json
COPY engines/k6/package.json ./engines/k6/package.json
RUN npm ci --ignore-scripts --include=optional
COPY tsconfig.base.json tsconfig.node.json ./
COPY tools/build-install.ts ./tools/build-install.ts
COPY tools/install ./tools/install
COPY tools/recovery ./tools/recovery
COPY contracts/src ./contracts/src
COPY contracts/engines ./contracts/engines
COPY agent/src ./agent/src
COPY app/src ./app/src
RUN node --import tsx tools/build-install.ts

FROM ${NODE_IMAGE} AS installer
# Runtime uses bundled code and installed engine dependencies, never package managers.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /beetle
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
COPY --from=bundle /build/tools/install/dist ./install
COPY LICENSE ./LICENSE
USER 1000:1000
HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/beetle/install/main.js", "--agent-worker", "/beetle/install/agent-worker.js", "--backend-worker", "/beetle/install/backend-worker.js"]
