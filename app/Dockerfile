ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

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
COPY tools/build-api.ts ./tools/build-api.ts
COPY contracts/src ./contracts/src
COPY contracts/engines ./contracts/engines
COPY app/src ./app/src
RUN npm run build:api

FROM ${NODE_IMAGE} AS backend
WORKDIR /beetle
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision=$VCS_REF
ENV NODE_ENV=production
COPY --from=bundle /build/app/dist ./backend
COPY app/package.json ./package.json
COPY LICENSE ./LICENSE
USER 1000:1000
EXPOSE 4311
HEALTHCHECK NONE
STOPSIGNAL SIGTERM
ENTRYPOINT ["node", "/beetle/backend/main.js"]
