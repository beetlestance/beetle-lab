# Empty namespace deletion evidence

Status: reviewed local implementation based on58b46bf. [Contract](../design/lld/namespace-deletion.md).
Organisation/workspace/nonroot-folder DELETE routes and provisional list controls
now use scoped versions, explicit confirmation and original retry identities.
All62 public JSON descriptors have actual configured-application registration.

## Protected metadata removal

Only empty scopes can be removed. Inputs, suites, child folders/workspaces, Runs,
retention snapshots/epochs and permanent settlement identities refuse. A previously
used workspace may therefore remain undeletable. This is an explicit restriction;
no nonempty cascade or admitted recursive maintenance is implemented.

One receipt-first transaction funds a permanent2048-byte identity marker from actual
installation capacity minus reserve. Exact replay after deletion/reopen adds no
charge. Marker insertion validates owner/version/root/settings and performs the
exact namespace removal in the same transaction. Root/settings identity cannot be
recreated through SQL or public mutations; marker replacement/update/delete refuses.
Global old CREATE receipts may replay historical identity but never resurrect rows.

Shared fixed indexed EXISTS predicates refuse protected children before marker
funding or DELETE, including raw marker SQL. Foreign keys remain the final guard.
Added scoped settings/settlement indexes remove two FK-check scans. Query-plan
regressions observe the actual protection query with unrelated folders;500 children
in the target prove refusal before marker insertion or parent DELETE. Existing
history-name metadata cleanup retains its scoped index/cascade rules.

## Checks and corrections

The scoped namespace/worker/HTTP/UI plus existing editor/scope and retention/settlement
migration lane passed56 cases across11 files in26.75s. Affected final behavior checks
passed27 cases across6 files in21.46s, including genuine predecessor migration,
late rollback, exact quota, input protection, URN/case identities, old-create replay
and an actual TCP response dropped after committed DELETE. Fresh compiled-worker
reopen recovered the same receipt, with exactly2048 charged bytes. Counts overlap.

Independent review required paid markers and two boundedness corrections: scoped
probes, then explicit EXISTS rather than relying on FK enumeration. Both were fixed
with regressions. Initial envelope/type/fixture/DOM and structural failures remain
in private evidence. Empty fixture capacity and historical projection helpers were
corrected without dropping retained data or weakening production checks.

Final Node/web types, lint, architecture, documentation, API drift and API build
passed in the frozen task check plan. The unchanged frontend source build passed.
A wider affected lane passed24 cases and exposed one input-overflow fixture failure,
reproduced on unchanged58b46bf: its raw SQLite connection omitted registered
validation functions. Using the existing initializer corrected setup; the unchanged
overflow case passed in3.59s and changed-file lint passed. No full-suite pass is claimed. Native cleanup was not rerun for this metadata-only feature.
No Docker image, user data/service, published repository or registry was changed.
Actual packaged browser, Linux/AMD64 qualification and recursive deletion remain
separate. DOM tests establish control behavior, not visual/accessibility acceptance.
