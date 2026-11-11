# Target observation artifact contract

Status: locally verified shared boundary; target UI remains pending.

The runner schema owns the beetle-target-runtime v1 artifact: target-reported
scope, at most256 samples, fixed32 metric names, finite nonnegative numbers or
null, UTC observation timestamps and bounded phase/status/reason fields. Missing
values stay unknown. Unavailable samples have a fixed reason and all-null values;
ready samples have no reason. Missed counts unavailable observations plus at most
one refused observation when retention is limited. No engine-control claims.

Shared capture/decode/encode at @beetle/contracts/target-runtime detaches/freezes
reports, enforces1MiB raw/serialized bounds and fatal UTF8, and rejects unknown
fields/getters/prototypes. Generated schema types and metric keys replace the
engine's separate type/name list. Artifact publication validates the shared shape
before writing/sealing, with the existing output allowance and newline accounting.

Eight focused codec cases passed, including zero versus null, status/reason/missed
contradictions, numeric/key/count/byte/timestamp limits, ownership and round trip.
Twenty-one unchanged sampler/attempt cases passed. One initial test incorrectly
compared canonical JSON key order with schema order; fixed to compare key sets.
Changed lint and Node types passed. Independent read-only review found no blockers.
Initial schema reference/strictTypes and worktree export-link failures were fixed;
no checks or assertions were disabled. Generated/browser/structural checks accompany
integration. No image build, service restart or native workload was run.

## Connected target views

The result reader reuses its existing matching-result guard and descriptor list,
with no additional inventory API. Exactly one target-runtime descriptor permits a
read; ambiguous descriptors are explicit. Browser reads use fixed scoped UUID
routes, two shared originals, no queue/retry/cache, a five-second whole-body/hash
budget and exact length/SHA verification before shared decoding. Fetch, stream,
cancellation and hash originals remain owned after an abort hint.

Session/scope/run/attempt/artifact changes retire prior values during render and
fence late callbacks; StrictMode and manual retry are covered. Summary uses the
single before point, observed during peak and actual last after point. Missing
final values stay unknown; contradictory phase/time order suppresses comparison
and growth hints. Only memory fields receive a qualified follow-up signal. The
chart preserves zeros/gaps, phase/time resets and finite extreme values. Valid
leap-second timestamps that JavaScript cannot plot remain explicit in the raw table.

Scoped byte, lifecycle, summary and result-integration cases passed, including the
native WebCrypto fixture digest. Chart cases/types/lint passed after coordinator
corrections. Independent review found leap-time extent and phase-order gaps; both
have regressions and correction acceptance. Final composed checks accompany this
slice. Real-browser qualification is pending: the required browser-control tool
is not exposed in this session. No user service was restarted or image rebuilt.
