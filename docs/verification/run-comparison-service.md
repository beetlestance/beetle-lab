# Comparison backend and HTTP

Status: reviewed local service, actual metadata worker/native files, authenticated
HTTP and application bootstrap. Browser comparison controls remain a separate slice.
Contract: [bounded run comparison](../design/lld/run-comparison.md).

One read-only comparison captures2..4 terminal runs and pinned revisions/results.
Shared k6 schema/layout resolves logical request/assertion identity across changed
aliases. Internal metric lookup reuses the existing verified numeric/archive owner,
without repeated catalogue paging or another parser. Missing inputs, unobserved
series, unavailable sources and absent results stay explicit. Declared target,
inline/uploaded inputs and secret-reference fingerprints contain no resolved values.
Config pointer diffs are bounded and limited explicitly; equal pinned content skips
traversal, while contradictory equal pins fail closed.

The service and lookup return their actual original promises. The HTTP context
supplies the fast disconnect/deadline race and retains its single credit through
physical settlement. Close fences admission and drains originals. Metadata, native
file and comparison budgets remain independently owned. No new table, migration,
dependency, stored comparison, engine call or target request was introduced.

37 new cases passed across scoped runs: logical reorder/removal, source/pin/seal
refusal, exact request capture, bounded/escaped pointers, large identical configs,
secret/inline-data canaries, held metadata/lookup originals, shutdown and HTTP
admission. Existing affected metric service, lifetime/resource and public/private
live-path cases also passed. Node types, changed lint and architecture passed;
[contract evidence](run-comparison-contract.md) owns schema/client checks.

A real worker plus verified numeric files and paired TCP/generated client returned
mean3 for a published synthetic run and result_absent for an actual unsent-cancelled
peer. Unknown run returned404. Independent fingerprints of11 domain tables stayed
unchanged across worker open/read/verified close. Concurrent raw inspection correctly
failed against the exclusive worker lock; inspection moved outside that ownership.
The actual application bootstrap also registers, serves and closes the new route.

Two review regressions reproduced false success before fixes: wrong returned peer
alias and revision content changed under an unchanged declared digest. Full selected
identity and canonical revision reconciliation now reject both. Large same-pin
configs use a guarded equality path; one test initially exceeded the existing4096
JSON collection limit and was corrected to an admitted4096-row configuration.
Three corruption fixtures initially mutated frozen seals; wire-like owned clones
fixed the setup. One auth fixture lacked Origin and correctly received403; the
no-cookie probe now includes a valid Origin. No gate or assertion was lowered.

This proves a synthetic backend boundary, not new native k6 execution, actual browser
charts, release-image packaging, target equivalence or resource-overhead qualification.
No Docker build, user-service restart, push or deployment was needed.
