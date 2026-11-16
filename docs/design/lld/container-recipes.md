# Rewrite frontend and backend image recipes

Status: component recipes locally verified; Compose/first-install wiring and release
qualification remain separate. See [evidence](../../verification/container-recipes.md). Published legacy image defaults are preserved.

## Ownership and build

app/Dockerfile builds only the existing compiled backend/metadata worker, then
copies bundles into a separate Node24 runtime image. web/Dockerfile builds Vite
assets and copies only dist into an unprivileged NGINX runtime. Neither runtime
image contains the other service. Agent and per-attempt engine images stay separate.
Use the already pinned Node base from agent/Dockerfile. No runtime npm install,
credential/config copying or host dependency requirement. Build-host dependencies
stay in build stages; runtime architecture comes from the target base image.

Build from repo root with -f app/Dockerfile or -f web/Dockerfile. Coordinator owns
recipes/build configuration; an independent source review precedes acceptance.
.dockerignore excludes local credential/agent state and nested host node_modules.
VCS_REF labels provenance; local qualification uses task-owned image tags/labels.

The frontend pins NGINX1.30.6 alpine3.24-slim at
sha256:e333a5b95605942b5e495645ee54fab02b112081de6dbe45d2ead3ef38e03e31.
Source: [maintainer registry](https://github.com/nginx/docker-nginx-unprivileged/pkgs/container/nginx-unprivileged).
Its actual OCI index was read and SHA-verified with Linux amd64/arm64 entries.
A manifest entry does not prove native platform execution or security clearance.
[Maintainer guidance](https://github.com/nginx/docker-nginx-unprivileged/blob/main/README.md)
describes the unprivileged port8080 and /tmp PID/temp layout used here.

## Runtime and proxy

Backend entrypoint node /beetle/backend/main.js, uid/gid1000, private port4311.
Existing private configuration/data loader and serving authority govern startup;
no initializer or synthetic fallback is added. Deployment may override to a common
non-root installation uid/gid. Set BEETLE_LISTEN_HOST=0.0.0.0 only on the private
container network, with canonical loopback BEETLE_EXTERNAL_ORIGIN.

Frontend runs uid/gid101 and one NGINX worker on8080, with read-only rootfs and
bounded writable /tmp supplied by deployment. Only frontend publishes a loopback
host port. Static /healthz proves only frontend process reachability.

Only /api/v2/ forwards to private service alias backend:4311 via Docker DNS.
Preserve original Host/Origin/cookie/CSRF headers; backend remains the authorization
owner. Proxy buffering/request buffering and upstream retries are disabled. No
proxy-issued mutation retry may follow unknown commit. Backend<=30s request budgets
remain authoritative; proxy connect/read/write limits are bounded. Body limit2MiB
matches the public maximum while backend per-operation limits remain stricter.

SPA navigation falls back to index.html. Assets/scripts/connections stay local;
CSP permits existing React inline style attributes. No iframe/object embedding.
API byte-stream and cancelled/error semantics must survive the proxy unchanged.
No agent/private runner route is exposed through frontend configuration.

## Validation scope

Use one task-owned Docker build lane with bounded builder resources/cache. Reuse
existing exact-source CI evidence if available; these new local recipes have none.
Do not push or change published tags. Check actual nginx syntax and a synthetic
same-origin proxy/backend session, including JSON/stream/error/mutation behavior,
with task-owned network/containers/data only. Remove only recorded owned resources.

Platform manifests/builds are distinct from native amd64/arm64 qualification.
Supply-chain scans, SBOM/license inventory, measured stack overhead, Compose source
and image-pull installs, real browser behavior and final image release gates remain
required. Do not infer those from Dockerfile presence or a static server healthcheck.
