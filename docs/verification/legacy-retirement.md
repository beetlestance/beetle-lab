# Legacy application retirement

The legacy server, runner, standalone load script, public assets, root Dockerfile,
legacy Compose recipe and their smoke/API tests are removed from maintained source.
Root start/dev commands launch the multi-container rewrite. The old Express/ws root
dependencies and69 exclusive lock entries are removed; all retained package records
keep their original resolved versions and integrity fields.

CI no longer builds or publishes the single-container application. Source checks,
six test shards, both native rewrite jobs, supply-chain/round-trip checks and both
fail-closed aggregates remain. Delivery trust drops only the obsolete legacy job;
qualified manual delivery keeps its existing repository/source/run binding.
Historical parity links point to the exact pre-retirement Git revisionaf8802e4.

## Deployment boundary

This source change stops default-branch legacy publishing only after it is merged
into that branch. Existing registry tags, releases and downloaded images are not
revoked or replaced by deleting source. Previously published `:latest` still
contains the legacy app. No new default image is promoted by this retirement;
source Compose is the documented installation path.

Local `.beetle/` data, current containers, test results and private configs are
preserved. This change does not implement installed-capacity reconfiguration,
resolve the audit's suspected queued-storage timeout/logging issue, or harden the
manual delivery branch/environment approval policy. Those remain separate work.

## Validation

Scoped local checks pass: types, lint, architecture, docs,58 affected cases across
six files, Compose configuration and workflow YAML/bash syntax. Independent review
accepted the CI/trust delta. The first docs pass exceeded the documentation-map
line limit; the corrected docs-only rerun passed without repeating green checks.
No current runtime source or retained dependency version/integrity changed. No
extra native load was run solely for deleting legacy source; ordinary PR CI owns
the source/native gates for the cutover.
