# Embedded reference and agent download

Status: reviewed local F17 implementation; source frontend image HTTP verified.
Base dfa83cb; source is the integration commit containing this report.
Contract: [embedded reference](../design/lld/embedded-reference.md).

## Functional surface

The existing sidebar opens /reference. Users can filter generated JSON operations,
inspect exact path/query/body/response schemas and read binary transfer contracts.
Schema resolution uses only the included catalogue; no schema URL or test is fetched.
The page makes no runtime API requests. Four stable public downloads provide the
route guide, complete API/binary catalogue, k6 configuration schemas and SKILL.md.

Agent instructions cover local cookie/CSRF access, scoped immutable revisions,
actual settings/profiles, exact mutation replay, bounded monitoring and verified
artifact/export downloads. They preserve task authorization. They discover the
current schemas without private repository access or invented transfer paths.
The full catalogue stays outside model context; only needed definitions are read.
The bundled file includes the MIT notice and advertises no SDK or MCP server.

Binary paths and input chunk bounds are shared with existing client/server owners.
The k6 download shares the existing eight structural schema sources; no compiler,
engine admission, limits or configuration fingerprint semantics changed.

## Evidence

Initial reference/UI/dev-HTTP lane: five passed in 16.13s. Corrected transfer/schema
lane: 58 passed in 20.36s, including existing input client/server and configuration
validation. Final consumer/shell lane: 19 passed in 6.83s. Downloaded k6 schemas
compile and accept a real synthetic revision config while rejecting invalid input.
All public message references resolve; an environment canary is absent from assets.
Skill frontmatter and the matching generated download pass skill validation.

A real source frontend Docker build passed after correcting config-time TypeScript
module bundling. On native Linux arm64/Docker29.9.2, its non-root read-only frontend
served all four expected resources with exact bytes/SHA256, MIME and nosniff.
HEAD lengths matched; missing assets returned404 and POST returned405. The task
container used configured64MiB/0.25CPU/32PID limits and a unique loopback port.
Exact task container/network cleanup succeeded. Assets were5417,12510,124646 and
21166 bytes respectively for skill, guide, API catalogue and k6 schemas.

Reviewer caught missing build-stage license and undiscoverable binary routes;
required license/schema sources and source-bound transfer guidance corrected both.
The first image build then exposed native config-loader package imports; public
entrypoints are now bundled through relative source imports in the build tool.
Only that failed build was repeated, reusing its bounded task cache. Native fixture
failures (unpublished internal-network port and helper naming typo) were retained;
normal task ingress and corrected helper passed with the unchanged image.

Node/frontend/script types, changed lint, architecture/docs and generated API
checks accompany the source. Private .beetle homes are excluded from build context.
No user service was restarted, no target traffic ran and nothing was published.

## Limits

Native HTTP serves the actual built files; it does not execute a real browser or
prove a full agent-model workflow. React navigation/schema selection is covered by
scoped DOM tests. No native amd64, backend-image rebuild, whole suite or release
matrix is claimed. Command search, dashboard rollups, dropped-load guidance,
producer retirement/final refund and remaining R4 work retain their own gates.
