# Opt-in Compose installation evidence

Status: locally verified native arm64 composition. No publication, default-image
replacement, full rewrite completion or release qualification is claimed.

## Source and commands

Topology candidate2cad6a5; accepted starter source511c44c; installer starter bundle
6cc2c27; actual ingress/exact-staging correction a47b1b7. Independent W320 source
review and focused follow-ups covered the topology, packaged CLI and correction.
Runtime image inputs matched their previously built source; no app/engine algorithm
was changed to pass this packaging check. Native Docker Desktop/daemon details
and backend/frontend IDs are in [component evidence](container-recipes.md).

One capped task-owned builder reused the prior dependency cache:
agent build3.71s, engine14.73s, installer with starter2.29s, all exit0.
Only changed/missing images were built; no full suite or backend/frontend rebuild.
Resolved `docker compose config --format json` plus normal `config --services`
passed with synthetic environment: only frontend publishes loopback; setup/images
helpers stay excluded from normal startup; mounts/resource/security/log bounds hold.
Control-service hard caps match the explicit starter reserve.

Private scripts, exact argv/image metadata, bounded logs, attempt evidence and
preserved installation data are retained under .agent-work/compose-installation
and .agent-work/container-recipes. The implementation/review Git bundles and
reports are archived before completed worktree/branch removal.

## Observed behavior and corrections

Actual compiled starter emitted the explicit private request. Installer inspected
the real daemon/images/network, created private files and actual Journal authority,
and published a ready receipt. Initial serving startup failed: an internal-only
frontend network did not provide published-port reachability, and the agent
rejected an ancestor staging mount. Backend itself started successfully.

Frontend now also joins an ingress bridge; backend/agent remain only on internal
control. Agent journal and exact staging root use separate same-path binds, with
explicit rprivate staging propagation. Existing staging attestation stays strict.
No images needed rebuilding for these wiring corrections.

Reusing the preserved installation proved offline ready replay without replacing
its settings/credentials. Serving startup and pairing then passed. One initial
run request received a known capacity_unavailable refusal before capacity was
ready; no workload launched. A bounded read-only settings-read readiness check
preceded the successful enqueue. A real one-request k6 workload then passed through
frontend/API/agent/native engine and published a durable result.

The first restart check picked an old startup token from accumulated logs and
failed pairing; the harness now selects the latest token. Only restart/read was
repeated, with no second workload: exact saved run/result were returned through
a fresh proxy session, and no replacement engine was launched.

All recorded task containers/networks were removed; no shared state reset or global
prune occurred. Initial failure evidence and private installation data were kept.
Actual capability diagnostics reported the expected immutable engine identity,
fresh daemon/statfs provenance and configured controls; credentials stayed private.

## Limits

These observations compose initial fresh provisioning and corrected serving replay;
another from-empty qualification of the final release recipe remains release work.
Native amd64, published pull installs, real browser flows, SBOM/license/security
scans, measured stack overhead, interruption/restore cases and full feature gates
remain pending. Config validation alone did not reveal the two startup defects;
source review is not a substitute for the observed runtime boundary.

See [local setup](../../deploy/local/README.md) for the explicit opt-in procedure.
