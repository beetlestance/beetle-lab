# Settlement values evidence

[Contract](../design/lld/output-settlement.md). These are closed metadata values,
not an implemented endpoint, local barrier, SQL settlement or refund permission.
Existing cleanup remains fully charged until those separate owners are qualified.

Runner schemas define exact retirement/reply-bound release requests and compact
settled replies. Generated types/registry/reference and conformance vectors agree.
Request digest has its own prefix. Agent tombstones preserve original Offer digest,
cleaned reply, settlement request digest, nine recorded metadata charge fields and
real retained output/staging hold amounts. Backend credit uses current retained
payload, old65536 metadata and separately funded65536 cleanup, less2560 floor.
The old maximum allocation must not be credited after prior finalization refunds.

Maximum-width complete canonical records plus512 logical row allowance fit the
agent4096 and backend2560 cells. Codecs reject unsafe sums, contradictory credits,
wrong original/digests, unknown fields, hostile getters and oversized intake. Actual
positive unsent enqueue→cancel→Begin produces null closure digest and zero output
allocation; its tombstone preserves those facts without inventing a native ACK.

Initial48focused cases passed3.00s. Expanded202cases/7files passed7.79s, generated
contracts.38s and types23.82s. Lint found complexity12 in one codec; identity checks
were extracted rather than lowering the limit. Independent review found the old
unsent null-closure mismatch and required local owner draining plus explicit post-
compaction replay semantics in the LLD. Corrected48cases3.33s, types17.87s,
lint7.71s, architecture6.96s, docs.82s exited0. Added real-unsent22-case file passed
2.31s. Counts overlap; source-bound plans/logs preserve each run and correction.
No native run is needed for pure values; actual settlement recovery remains pending.

Never-admitted originals lack this real disk-hold transfer authority and remain
protected pending their own positive funding/compaction rule. Exports remain outside
performance settlement qualification. No user service or published image changed.
