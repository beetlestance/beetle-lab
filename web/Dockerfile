ARG NODE_IMAGE=node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8
ARG NGINX_IMAGE=ghcr.io/nginx/nginx-unprivileged:1.30.6-alpine3.24-slim@sha256:e333a5b95605942b5e495645ee54fab02b112081de6dbe45d2ead3ef38e03e31

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS bundle
WORKDIR /build
COPY package.json package-lock.json ./
COPY app/package.json ./app/package.json
COPY agent/package.json ./agent/package.json
COPY contracts/package.json ./contracts/package.json
COPY web/package.json ./web/package.json
COPY engines/k6/package.json ./engines/k6/package.json
RUN npm ci --ignore-scripts --include=optional
COPY tsconfig.base.json ./
COPY contracts/src ./contracts/src
COPY contracts/scripts/standalone.ts ./contracts/scripts/standalone.ts
COPY web ./web
RUN npm run build:web

FROM ${NGINX_IMAGE} AS frontend
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/beetlestance/beetle-lab" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision=$VCS_REF
COPY --from=bundle /build/web/dist /usr/share/nginx/html
COPY web/container/nginx.conf /etc/nginx/nginx.conf
COPY LICENSE /usr/share/licenses/beetle-lab/LICENSE
USER 101:101
EXPOSE 8080
HEALTHCHECK NONE
STOPSIGNAL SIGQUIT
ENTRYPOINT ["nginx", "-g", "daemon off;"]
