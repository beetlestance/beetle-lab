# Run result presentation

Status: presentation component implemented and independently reviewed. Uses existing
Run and EngineResult contracts and project theme tokens. See
[component evidence](../../verification/run-result-panel.md). Backend result persistence/read
routes and real-engine/browser qualification remain separate required work.

Public feature entry exports RunResultPanel and RunResultProps. Props in types.ts
are root-owned: expected workspace scope/runId, validated bounded Run/result DTOs
or null, and loading/unavailable/error/ready status. No new endpoint/query/client,
engine metric interpreter, download URL, credential or mutation is introduced.

Before showing any run/result content, require expected organization/workspace and
runId match Run.scope/id. Result must additionally match activeAttemptId, scope,
engine ID and generation1. Stale cross-scope/run/attempt data is hidden immediately
on rerender, including artifact count/names/reasons; never keep a previous value as
an invented successful replacement. Use fixed unavailable/error/loading text.

Run state/outcome is authoritative application display, independent of engine
reported outcome. A nonterminal run with a passed EngineResult remains awaiting
finalization; label engine outcome explicitly provisional. Cancellation/error never
becomes passed because an engine reported success. Missing results/metrics remain
unavailable, never zero. Do not render or traverse arbitrary engineSummary JSON.

Show bounded declared artifact metadata (<=128 items), IDs/kind/relative path/bytes/
hash with semantic table/list labels and long-token wrapping. These are declarations,
not a verified/downloadable publication receipt. No guessed links or fake download
buttons. Known empty artifact lists differ from missing results. Keep all dynamic
content escaped by React. No new typography/assets or hard-coded palette; reuse
existing light/dark tokens, responsive spacing and reduced-motion conventions.

Mount the panel in current RunDetail using active requested scope/runId and its
existing Run query, result=null/status unavailable until an actual result read
contract exists. Replace the current blanket unavailable paragraph without claiming
metrics/artifacts are delivered. Component tests cover populated synthetic DTOs;
no fake production data or route is allowed. Loading/error behaviors belong to the
component now; parent query can retain existing QueryState handling.

Required evidence: pending engine pass vs terminal run outcome, cancellation/error,
missing states vs known empty artifacts, immediate workspace/run/attempt/engine
switch fencing, long content/128 bound and accessible semantic labels, existing
RunDetail/session/query behavior. Actual browser qualification is recorded separately.
