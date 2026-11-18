# System contracts

Cross-module behaviour that types cannot express: who owns each side of a
boundary, the invariants both sides rely on, limits, ordering and failure
handling. Request and response shapes live in the generated contracts under
`contracts/`; module internals live in each module's `CONTEXT.md`; the reasons
behind choices are in [decisions](../../decisions/).

Change a contract in the same commit as the code it describes. Each contract ends
with an **Anchors** table naming that code and the hash it was last reviewed
against; when anchored code changes, `npm run check:docs` fails until someone
rereads the contract, corrects it and runs `npm run docs:stamp -- <file>`.

| Implementing or changing | Read |
| --- | --- |
| Backend ↔ agent operations, envelopes, fencing, idempotency | [Execution protocol](execution-protocol.md) |
| Installed engines, profiles, configuration schemas, preflight | [Engines](engines.md) |
| Run states, intake, observation, cancellation, stop | [Run lifecycle](run-lifecycle.md) |
| Dispatch claims, delivery, event custody, scheduling | [Run delivery](run-delivery.md) |
| Producing, staging, transferring and downloading outputs | [Outputs collection](outputs-collection.md) |
| Finalising, settling, adopting and deleting outputs | [Outputs settlement](outputs-settlement.md) |
| Removing retained output | [Retirement](retirement.md) |
| Deleting organisations and folders, retiring workspaces | [Namespaces](namespaces.md) |
| Cold backup, historical restore and recovery control | [Recovery](recovery.md) |
| Capacity, reservations, resource observations, timeouts | [Resources](resources.md) |
| Installing, packaging, starting and identity binding | [Installation](installation.md) |
| Offline image upgrade, upgrade fence, pre-activation rollback | [Upgrade](upgrade.md) |
| Metadata, journal and file stores; administrator session | [Storage](storage.md) |
| Results, metrics, reports, comparison and live snapshots | [Results](results.md) |
| Standalone k6 script export | [Exports](exports.md) |
| Uploaded inputs and request bodies | [Inputs](inputs.md) |
| Input times, row/column counts, usage and delete blockers | [Input metadata](input-metadata.md) |
| Public `/api/v2` rules, authorisation, history and suites | [Public API](public-api.md) |
| Suite descriptions, revision stamps, run notes and run times | [Authoring metadata](authoring.md) |
| Folder summaries, suite filters, latest runs and revision run counts | [Suite listing](suite-listing.md) |
| Browser scope, polling, bounds and truthful state | [Web UI](web-ui.md) |

Layout, owners and dependency edges: [architecture](../../engineering/architecture.md).
