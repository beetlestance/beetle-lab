# Protected retention controls

Public entry RetentionControls({scope, run?}); workspace settings and terminal Run
views open it explicitly. Collapsed controls perform no extra reads. Existing styles
are retained; this is functional UI, not the deferred redesign.

Generated ApiClient owns closed schemas and route/request/reply binding. Every
mutation captures one request body/UUID; unknown outcomes permit only explicit
identical replay. Scope/API retirement aborts and fences callbacks without implying
rollback. Backend originals and cleanup ownership remain authoritative.

One bounded shared ReadAdmission serialises exposed API read promises, at most four
waiting intents with a five-second deadline. It does not strengthen underlying
fetch cancellation. Run views share their existing gate; standalone settings get
an owned gate. Unmount cancels/removes scoped retention queries.

Batch inventory is at most eight. Original previews recover immutable settings,
membership and continuation; Apply admits the exact displayed nonempty batch.
Expired previews cannot Apply. Continuation selects the newly committed page.
Status polls while applied and visible, stops on errors/completion. Unknown bytes
stay unknown. Counts/credit come only from status, with no optimistic deletion or
physical-free-space claim. Explicit acknowledgement removes replay/status records;
a missing response/ID cannot fabricate acknowledgement or another refund.

Checks: scoped retention UI/lifetime and affected run/settings cases; types, lint,
architecture and web build. Browser visual inspection requires an available browser
execution tool; no production service restart is authorised for these controls.
Parent traversal and driver diagnostics are separate remaining owners.

ParentRetentionControls in installation/org settings explicitly creates one live,
partial traversal window. It retains the parent cursor/settings pin for continuation
and an identical request on unknown outcome; no parent Apply exists. A scope-bound
workspace link carries only the saved batch UUID. Workspace settings validate that
query ID, recover preview/status and require explicit Apply. Empty parent responses
are labelled non-durable; no installation-wide coverage or combined budget is shown.
