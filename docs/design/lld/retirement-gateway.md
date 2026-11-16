# Original-bound retirement gateway

Status: private transport capability; automatic dispatch and ACK storage pending.
Parents: [runner transport](retirement-transport.md), [backend request projection](backend-retirement-request.md).
Owner: app outbound runner; port app/ports/runner-retirement.ts.

The installation's existing createRunnerGateway additionally implements
RunnerRetirementGateway.retireOutput(request, signal). It shares the same configured
origin/token, original native IO and two source credits. There is no separate client
pool, new credentials, scheduler, store, public route or retry implementation.

Reserve shared source/ordinary credit before observing caller request properties.
Capture the closed <=3072-byte request once; use only its detached owned snapshot for
path, exact physical Journal/scope headers, bounded body and response expectation.
Send POST to the dedicated attempt output-retirement endpoint. Read <=4096 bytes using
the existing pinned original Node HTTP owner; redirects and unexpected success
statuses cannot produce cleanup evidence. Error protocol parsing remains scoped.

On200, use the semantic reply codec and trusted Node SHA256 injection to match the
COMPLETE original request, including closure digests/final sequence, before returning
ok for pending or cleaned. Shape-only generated SDK validation is insufficient here.
This authenticates transport and identity, not a standalone cryptographic IO proof.

The existing fixed five-second gateway deadline includes DNS and all native work.
It may interrupt the agent's longer bounded operation. Abort/timeout/shutdown ask the
original to stop and retain its credit until actual request/response/socket closure.
No early return, automatic retry, rollback claim or refund follows from timeout.
Already validated positive evidence survives later cancellation after all closes;
without such evidence the call fails. A later explicit call reuses the same durable
request. Gateway close drains the same originals before installation resources close.

This capability is not wired into the deletion background driver. Pending never
means ACK; cleaned still requires a separate exact immutable backend ACK transaction.
Neither result releases storage charges, removes replay identity or creates a public
delete operation.

Acceptance: real synthetic TCP pending/cleaned and exact request/headers; every scope/
Run/deletion/physical-authority/digest/closure mismatch; shared capacity before traps;
caller mutation during held DNS; oversized request/reply; non200; no-evidence abort;
positive EOF and independent native closes through abort/deadline/shutdown.
