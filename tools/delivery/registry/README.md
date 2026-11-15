# Immutable candidate plan

This local preparation step performs no registry writes and never rebuilds images.
It uses the pinned regctl 0.11.7 binary with owned empty credential/config paths.

```sh
node --import tsx tools/delivery/registry/plan.ts STAGED SOURCES NEW_OUTPUT REGCTL
```

All arguments are absolute paths. Stage and source records must be complete and
match the exact candidate revision and all twelve config digests. Their archive
bytes are hashed again at this boundary. Run the tool in one exclusive process;
its private environment is configured for its own regctl/Docker configuration.

The source OCI index has six repeated short `transport` tag annotations. Imports
therefore select each original OCI manifest by digest, matched to its qualified
config, rather than by tag. Raw imported manifest/config hashes, platform and
revision are checked. Six role indexes must each contain precisely their AMD64
and ARM64 manifests. Source, revision and documentation annotations accompany them.

`publication-plan.json` contains public identifiers, expected manifests and source
archive identity. It contains no local paths, credentials or command logs. It is
written only after the complete local plan verifies. Private tool/config/layout
files must never be uploaded wholesale. Publish only explicitly selected safe files.

The manual delivery mode of `ci.yml` calls `rewrite-delivery.yml`. It accepts the
successful source CI run ID and full revision, then downloads and verifies that
run's eight artifacts. It never rebuilds accepted images or runs source artifacts.
The source run must retain every gate required by `trust.ts`.

Publication uses two prereleases: `rewrite-sources-SHA-RUN` contains source/notices
before image distribution; `rewrite-SHA-RUN` receives installation assets only
after AMD64 and ARM64 anonymously pull and execute the candidate. Existing release
tags must resolve to the candidate SHA; conflicting assets/tags are never replaced.
All six role tags include SHA and RUN. Compose references use immutable index
digests, preserving exact child/config identities across architectures.

The publisher has narrowly scoped registry/release credentials. Native jobs have
no registry credentials and use a fresh private vfs daemon, then a second empty
Docker configuration for actual Compose execution. Only closed public records are
uploaded. The finalizer rechecks remote identities and anonymously downloads the
published environment and Compose assets, comparing their complete byte hashes.

Downloaded `beetle-lab.env` and `docker-compose.yml` belong in the same directory:

```sh
docker compose --env-file beetle-lab.env up -d
```

The default UI is http://127.0.0.1:4567. Installation is qualified only when both
native jobs and finalization succeed; a published candidate alone is insufficient.
See [image delivery](../../../docs/verification/rewrite-image-delivery.md).
