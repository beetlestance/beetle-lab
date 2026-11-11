# Advisory live mailbox envelope

Public entry index.ts; no Node or engine imports. Fixed 128-byte head/footer and
65,536-byte payload capacity: total65,792 bytes. Big-endian revision/length, SHA256,
reserved zeroes and matching committed envelopes; revision1..65536 never wraps.
Busy/invalid/torn images throw one fixed error. No retry, freshness or provenance
claim: caller additionally validates the existing frame, scope, epoch and subset,
and requires envelope revision == frame publication sequence.
The returned frame borrows a bounded image; callers must not mutate/recycle its
backing store until validation/response encoding ends. No accumulated frame cache.
Ownership/admission/transport contract: decision013 and live-metric-snapshots LLD.
Focused tests: contracts/src/live-mailbox/mailbox.test.ts.
