# Run intake commands

Public entrypoint: prepareRunCommand in index.ts. Inputs are one create operation
and trusted digest. Output is a frozen <=64KiB command; strict public request,
distinct UUID allocations and timestamp are validated. Canonical request digest
excludes allocations/time so exact replay preserves original IDs at the store.
No I/O, queue, agent call or retry. The RunStore port owns receipt-first atomic
run/attempt/Offer/outbox acceptance; it is not implemented by this module.
Contract: docs/design/lld/run-intake.md. Checks: scoped command tests + Node TS/lint.
