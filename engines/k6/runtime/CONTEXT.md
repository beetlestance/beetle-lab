# Native k6 request runtime

`index.ts`: `createRuntime` accepts an accepted compiled suite, explicit HTTP,
clock, sleep, random and metric adapters, a private secret resolver and limits.
One instance belongs to one VU; selection state is isolated by scenario. `prepare`
and `iterate` both require the caller's accepted deadline. Results contain only
fixed classifications and counts. Required assertion failures always emit evidence.

Private attempts are managed `{timeoutMs,deadlineMs}` or standalone `{timeoutMs}`,
with explicit mode and timeout1ms..48h. Managed absolute deadlines include earlier
prepare/init elapsed; setup also clamps to the accepted timeout. Standalone starts
one fresh deadline at setup, before readiness; pre-setup init and OS enforcement
are excluded. Setup returns only that number to all VUs. Missing setup data fails
closed. Scenarios clamp accepted duration/grace timing to this shared deadline.

Public `native-entry.ts` composes native adapters/options/summary. Init reads only `/beetle/secrets/<declared-name>`;
trusted staging must cap files before native `open` buffers them. Limits: 64KiB
per secret, 1MiB total. Values stay in private closures and request use.
`options.ts` registers required/execution failure thresholds and bounded evidence
submetrics. Native system tags are disabled; deterministic rN/aN labels admit at
most 200 distinct tag maps, including the aggregate. HTTP status failures retain
native http_req_failed semantics; assertion and transport classifications differ.
Redirects are disabled in v1. `throw:true` prevents native request-warning logs;
the runtime catches and replaces transport errors with fixed classifications.

Bodies default to responseType none. Body/JSON assertions opt into retained text.
Stock k6 buffers retained bodies before JS. The default 1MiB/max8MiB processing
cap, plus 65536 JSON nodes/depth32, applies after native buffering; it is NOT a
download cap. Product execution requires a hard engine RAM limit: oversized native
buffering may OOM that engine and cannot establish success. No native heap/HTTP
limit or Docker qualification is claimed by these unit/native compatibility checks.
Summary projection admits only known numeric metrics and threshold booleans.

Checks: TypeScript `-p engines/k6/tsconfig.runtime.json`; runtime Vitest tests.
