# Backend retirement request evidence

Status: read-only source-local request projection; dispatch/ACK/refund remain pending.
Base0f0afbb. [Contract](../design/lld/backend-retirement-request.md).

The existing metadata worker derives exact requests from committed deletion and
retained original/finalization/event/file owners. No schema migration or new table.
Tests exercise partial receipts, source and zero/nonzero absence closures, wrong scope,
closed-key/reply binding, unsent refusal, and missing retained middle event despite
unchanged final row/counters. The actual compiled-worker/native-file fixture reopens
the database and repeats the same request with unchanged producer facts and charges.

Initial affected lane:119cases passed; two historical migration fixtures failed
because current enqueue requires a later table. The corrected seed copies one genuine
queued original through actual schema12 guards and lets historical triggers reconstruct
ownership markers; no guards or assertions were removed. Corrected migration2cases
passed2.17s. Lint then required file-receipt and reply-capture responsibility splits.
Final affected correction:12cases/4files passed10.86s; types17.60s, lint7.54s,
architecture5.75s, docs.51s and API build.83s exited0. Unaffected119-case evidence
is reused. Independent review accepted projection, fixture and helper corrections.
Private check-runner records commands, source inputs, failures and durations.
Native task image evidence at0f0afbb covers normal execution, not this projection or
the full cross-service cleanup chain. No running services or published images changed.
