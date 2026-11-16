# Private live metric HTTP evidence

Status: local route and original-custody evidence; activation remains off.

GET /runner/v1/attempts/:attemptId/live-metrics uses mounted bearer, bounded raw
headers, organization/workspace/generation and exact Journal authority. Browser
metadata, queries, body selectors and non-first generations reject before service
work. Trusted wiring reads existing Supervisor ownership; no launch or allocation.
Absent/unavailable data returns503, saturated reads429, with safe protocol errors.

Shared snapshot capture/hash/scope validation precedes a <=64KiB canonical JSON
reply with no-store. Live operations independently occupy <=2 of32 ordinary credits;
source transfer retains its own two slots. Both reuse one finite response owner.
The fixed5s deadline includes service/decode/encode/response. Timeout/disconnect
aborts but retains credit until original service, request, response and socket close.
Shutdown fences intake and drains those originals. Control routes remain available.

Scoped route tests cover authority/body/query rejection, missing/busy/stale service,
scope/digest/getter rejection and byte budget. Task-owned real loopback tests cover
five-second timeout, ignored abort, source/control headroom, held response writes,
pre-service disconnect and shutdown. Affected source/authority regressions accompany
the change. This does not establish actual engine-to-browser transport, overhead,
new images or amd64 qualification. No user service was restarted.

Failures were preserved: initial injected replies needed an event-loop turn for
physical close; a held-response fixture initially held error responses too and
was stopped/corrected. An existing source-parser test now awaits observed server
socket close rather than assuming one scheduling turn is sufficient. Loopback
checks require the authorised native lane. A literal default parameter annotation
was corrected after typecheck. Final affected cases, lint/types and structural
gates passed; independent review found no blockers. Passed scopes were retained.
