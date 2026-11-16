# Authenticated agent settlement evidence

[Contract](../design/lld/output-settlement.md). The runner now exposes authenticated
`POST /runner/v1/attempts/{attemptId}/output-settlement`, with3584-byte requests and
512-byte exact request-bound replies. Generated descriptors/client and shared wire
bounds agree. Credential, scope, physical Journal authority, generation, path and
closed shape are checked before dispatch. No generic receipt-import route exists.

Root composes a two-entry process owner. It captures the original deadline before
read-only Journal preflight, then fences and drains actual local cleanup leases.
Worker eligibility is checked again in the committing transaction. Cancellation of
an unissued fence removes its single waiter and invalidates any minted proof without
releasing native work. A synchronous final budget check precedes the client's carrier
claim; issued metadata cannot be withdrawn. Unknown/failed termination retains its
entry and fence. Root stops unissued waits before joining issued work and shutdown.

Tests exercise actual compiled Journal workers and authenticated task-owned TCP:
preflight without purge; exact settlement/replay; ineligible/mismatched ACK refusal;
credential, namespace, authority, generation, path and size rejection; capacity before
held preflight; abort/stop/deadline during held native drain; cancellation after proof
minting before carrier claim; rejected real Worker termination in preflight and commit;
HTTP disconnect and server shutdown waiting on held actual worker termination; exact
reply recovery through a fresh worker and server after a lost committed reply.
Repeated256 cancelled drains preserve the held native lease without waiter accumulation.
A test-only seam reaps a failed fixture worker without healing sticky service ownership.

First scoped lane passed20cases, then lint rejected ingress complexity11. The route
classifier was factored into one shared source-operation predicate; no gate changed.
The corrected lane passed20cases in19.24s, types16.56s, lint7.01s, architecture8.45s,
docs.44s and generated contracts.27s. Added cancellation/reopen checks passed8cases
in9.49s, types16.17s, lint7.05s and agent build.83s. Counts overlap and are not a
full-suite claim. Prior agent transaction/accounting evidence is reused unchanged.
Independent review found no blocker, conditional on the final lane, which passed.
Final prose-only docs/check comparison is retained with private source-bound logs.

Native cleanup uses real task files, fake Docker decisions and portable inventory
ports. This is not whole Linux-container settlement, backend credit/purge or public
retention qualification. No user service, registry or remote repository changed.
