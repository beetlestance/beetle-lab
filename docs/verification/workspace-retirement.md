# Used workspace retirement

User-approved correction to the original empty-only workspace restriction.
Base b24afb13; production migration028. [Contract](../design/lld/workspace-retirement.md).
Local worker/application evidence; new packaged candidate qualification remains pending.

## Accepted local behavior

Retirement hides saved folders, suites, published input metadata, revisions and
terminal Run history from ordinary workspace navigation and scoped HTTP access.
Canonical names, root/settings, revision pins, receipts and paid ownership stay.
The name can be reused by a new UUID. Parent organisation removal still refuses
retained workspace dependencies. No output or input file is unlinked or refunded.

Real compiled-worker tests preserve published input/revision identities and pins,
open the retired scope in physically read-only historical mode, and recover the
same workspace DELETE acknowledgement after worker/application restart. Other
workspace mutations are fenced before old mutation-receipt replay. An old CREATE
workspace acknowledgement remains historical and does not restore visibility.

Indexed predicates refuse queued/dispatching/active/finalizing Runs, terminal
but charged execution, unfinished input intake, queued and claimed exports.
Execution reconciliation stays available until release; retirement afterwards
retains the charged output allocation and adds exactly2048 marker bytes.
Organisation counts, recent entries and activity exclude retired contents.

The configured application checks every declared workspace-param operation
through its registered route. Authenticated requests to retired scope return404
before body parsing, except exact workspace DELETE replay. Separate hook tests
prove authentication runs before existence checks and the DELETE exemption uses
the exact registered path/method, not a prefix.

Fresh workspace/manual/parent retention previews, parent replay/continuation and
unissued Apply cannot mint work under retired scope. Already admitted maintenance
Apply retains its exact acknowledgement, original intents and progress.

## Migration and rollback

Real populated schema027 upgrades retain every original row/value, custody record
and receipt; only workspaces gain retired=0. Foreign keys stay valid. A collision
at the final new trigger rolls schema, data and version back exactly to027.
Raw flag/key transitions, retired-row deletion/update and fresh child insertions
refuse. A synthetic late retirement failure rolls back flag/key, marker and charge.
Exact quota tests retain2047-byte refusal and2048-byte success/once-only replay.

## Verification scope

Focused Vitest files: storage namespace-deletion/guards/migration, workspace-
retirement/busy/migration, retention workspace-retirement/parent/manual, exports
workspace-retirement, configured bootstrap workspace-retirement and HTTP hook.
Provisional UI tests check scope-specific retention copy, identical retry identity,
acknowledged list removal and organisation-overview refresh. These are DOM checks,
not packaged browser evidence or the deferred UI redesign.

Review found parent retention replay/continuation and manual-preview visibility
gaps; both were corrected with real fixture regressions. Initial fixture list
queries omitted required limits; the manual fixture incorrectly carried a page
field; an unused migration projection field failed lint. Corrections retain all
production guards and gates. Earlier failures remain recorded in the task checkpoint.
No user installation, public image tag or default release was changed.
