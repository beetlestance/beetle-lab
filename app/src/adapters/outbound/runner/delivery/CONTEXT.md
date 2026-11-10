# Delivery runtime

Public entrypoint: startDeliveryRuntime(options), implementing ports/delivery.ts.
One nonoverlapping timer turn alternates queued/reconcile discovery, scans <=32,
selects <=one candidate and holds <=one original Offer. Two bounded continuations
preserve captured-pass fairness. No client/Offer queue or per-run timer exists.

The stored claim authority supplies the client identity. Replay always GETs before
same-original PUT; only a validated scoped attempt_not_found404 authorizes reoffer.
Acknowledged404 stays charged. Scoped validated Run reads fence cancellation,
terminal state and active-attempt mismatch before PUT; they cannot serialize later
cancellation commits. Existing receipts can receive generation1 cancellation.

Every positive response reaches store.observe, including during close. Store owns
merge/ACK/release; event/output/result completion is outside this runtime. Missing
receipts retain charge until matched refusal/release evidence is observed.

Remote uncertainty advances fairness. Local request failures or thrown operations
stop scheduling, await onFailure once and remain retained for close. Callback
failure is retained alongside the operation failure. onFailure must not await
this runtime/composite close. close stops network mutation synchronously, aborts
as a hint, drains originals/observations, and never closes the shared gateway.

Focused verification: npx vitest run app/test/delivery; scoped ESLint and Node TS.

Cancelled unacknowledged originals use cancelOriginal after scoped absence,
including freshly claimed originals. ACKed absence stays unknown; no PUT fallback.
