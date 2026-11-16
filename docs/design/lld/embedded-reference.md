# Embedded public API reference

Status: implementation contract for F17; independent of deferred UI redesign.
Owner: frontend reference feature and source-build public reference asset plugin.

## Read-only product surface

The existing application shell links to /reference. Generated apiOperations owns
JSON route/method/status names and required implementation status; apiMessageSchemas and apiSchemas own exact message
references/definitions. No second endpoint catalogue or live API probe is added. Every JSON descriptor
is implemented or planned. Planned operations retain their schemas/clients but
have no shipped route; route registration rejects them until the source status
is updated. The reference shows/filter this status and agent instructions require
implemented entries. Implemented means registered in the standard configuration,
not runtime readiness or release qualification. A composed application fixture
checks every descriptor against actual route registration, including input services.
Filter input is capped at 128 characters; show at most 80 matching JSON operations and the
actual match count. Selection exposes path/query/body/success schemas as text.

Resolve only included generated schema IDs and JSON pointers. Never fetch a $ref
URL, render raw HTML or interpolate a user query into a request. Inline source JSON
is capped at 64 KiB before formatting; pretty output at 256 KiB, with complete compact
fallback. Unavailable/oversized definitions show an explicit catalogue fallback.
References remain references, not a falsely self-contained request schema.

## Public downloads

One lightweight app/reference-downloads registry, re-exported by routes, owns stable URLs. The same Vite plugin serves development
resources and emits source-build assets:

- /reference/public-api.json: generated operations, message references and the full
  included schema catalogue and binaryOperations; bounded at 2 MiB.
- /reference/public-api.md: existing generator-owned public route reference.
- /reference/beetle-lab/SKILL.md: authored v2 agent instructions with MIT notice.
- /reference/k6-config.json: the same eight source schemas/root ID used by k6
  structural validation, bounded at 256 KiB; no compiler/runtime capability.

Only fixed shipped sources are read. Bound skill/reference/license reads before
materialization; no runtime environment, installation config, user metadata or
agent credential is read. Downloads are public static files. Development serves
only GET/HEAD at these exact paths with fixed MIME/attachment names and nosniff;
POST is 405. Production serves known files under /reference/ with fixed MIME
types and returns 404 for missing assets. The source image bundle stage explicitly
copies the license, generated contracts and k6 schema sources.

The asset plugin retains one immutable bounded resource set per build/dev-server
instance. Resources require no backend session and cannot start tests or install
an agent. Missing/bad/oversized source aborts build/startup rather than publishing
an HTML fallback as a successful instruction download.

Binary transfer descriptors are separate from generated JSON operations. Artifact
and export paths use existing public owners; input upload/content paths and chunk
size now use one public owner shared by the actual client, server and reference.
The catalogue includes required offset/body/header and full-download integrity
guidance. It does not create new binary endpoints or alter their authorization.

## Agent workflow

The skill is standalone and discovers matching public contracts from the running
installation. It covers automatic cookie/CSRF exchange, explicit paired mode,
scoped immutable revisions, actual settings/profiles, stable mutation replay,
bounded monitoring, terminal/result distinctions and verified artifact/export
reads. It preserves task authorization and does not grant a new target/budget.
No SDK, MCP server, private runner credential or additional engine is advertised.
The generated catalogue remains the single payload/route authority.

## Acceptance

Use actual HTTP dev assets and emitted build files to verify MIME/status/HEAD,
complete resolvable catalogue, matching content and no environment canary leakage.
Exercise shell navigation, bounded filtering, operation/schema selection and
no API mutations. Validate the skill frontmatter and shipped download. Run scoped
frontend/script types, lint, architecture/docs, generated API drift and one web
build. No user-service deployment, Docker rebuild or hosted/browser release proof
follows from this source slice.
