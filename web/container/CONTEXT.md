# Static frontend container

web/Dockerfile bundles the current React application and serves it with a pinned
unprivileged NGINX image. Port8080, uid/gid101, read-only rootfs and bounded writable
/tmp belong to deployment. No Node/backend/agent runtime shares this container.

Only /api/v2/ proxies to private backend:4311 through Docker DNS. Original Host,
Origin, Cookie and CSRF headers reach existing backend authorization. No automatic
upstream retries or proxy/request buffering; native HTTP transfer failures retain
their meaning. Backend deadlines remain authoritative. /healthz proves only the
static server is reachable, not installation/agent readiness.

SPA routes fall back to index.html. Assets are bundled locally. CSP permits the
existing React inline style attributes; scripts/connections remain same-origin.
No credential/config/token enters the image. Pin changes require source/platform
verification and image scanning. Current recipes are rewrite components; published
legacy defaults stay unchanged until R0-R4 qualification.
