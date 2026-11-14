# Suite configuration and history overview

Status: implementation contract for the selected configuration/history parity slice.
Placement is provisional: show summaries in the selected suite/revision view, which
already reads that immutable revision, rather than fetching configs for every list row.
The later UI redesign can change placement after a separately budgeted read model.

Target origin is parsed from the configured HTTP(S) target, excluding credentials,
path/query/fragment. Missing/invalid/unprojectable source is unknown; do not resolve
secrets, inputs or inherited runtime defaults. Show at most8 configured scenario
summaries, with explicit remaining count. Copy only closed executor and literal
workload/max/step durations or stage count. These are configuration fields, not
measured time or a second compiler’s derived whole-run duration. Keep offsets/grace
explicit when known; iteration maxDuration is a limit, not expected completion.
No config mutation, extra revision read, new persistent projection or storage grant.

RunListQuery adds an optional exact suiteId. Resolve it under the requested
workspace before reading; foreign/missing suites refuse. Existing suite/time/state/
outcome indexes provide keyset order. Name and suite filters intersect, and prefix
search retains its existing256-candidate workspace cap before other filters.
Client reply guards require every returned Run’s suite identity to match.

No-suite cursors preserve existing encoding. Suite-filtered cursors use v3 and
bind the normal query plus canonical suite ID; changing/forging it refuses before
repository reads. V3 has a1024-character cap; old encodings retain512. No OFFSET.

The selected suite shows the latest retained submitted Run through a limit1 query,
with explicit scope/state/outcome and link. No retained runs does not mean never run.
A link opens full history with validated bounded suiteId URL context. Resetting
ordinary filters keeps that context; an explicit workspace-history link clears it.
Scope/query/session replacement hides retired values, and errors mean unknown.
No new background polling or execution is introduced.

Acceptance: all executors represented honestly; no secret/body/header access by the
projection; malformed/large collections bounded; old/current revision labels explicit.
Suite history index/cursor/filter intersection and cross-scope worker/HTTP/client
negatives; late UI replies and latest/full-history links. Reuse existing native
execution evidence: this is metadata and presentation work, not new release proof.
