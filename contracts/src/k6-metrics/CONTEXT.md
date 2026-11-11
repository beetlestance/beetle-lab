# Pure k6 metric policy
Public static definitions/counter names, k6MetricLayout, k6MetricScope and
k6MetricCatalogue. This is the single moved source of existing engine rules.
Node-free runtime module; imports from other contracts are type-only. No validator,
compiler, dataset, secret, file, clock, network or threshold work occurs here.
Callers supply schema-validated raw config or an accepted compiled suite. Required
request/assertion order and IDs match both shapes; readiness adds no hidden check.
Labels rN/aN preserve existing order; <=200 total sets, <=4600 catalogue rows.
Layouts are detached, frozen, factory-branded and not a wire/IPC format. A forged
layout cannot trigger traversal. Catalogue scope/tags/order remain unchanged.
Engine plan/metrics retains compiled-load threshold validation, including rejecting
measurement-marker thresholds. The native builder admits only this exact shared
source file under its existing source-byte cap; no contracts-directory allowlist.
Checks: policy.test.ts and affected engine runtime/build/catalogue cases.
