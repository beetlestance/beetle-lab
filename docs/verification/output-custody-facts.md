# Collected output facts

Status: independently reviewed and locally verified producer step. Source
`5623296a9d18ff9415ff579ec1f70ed1161abe92`; integration
`395a1a84bd3c641a30238b875a543573b76e5e7d` has an identical tree.
Contract: [collected facts](../design/lld/output-collection-custody.md).

The existing collector now preserves immutable private root identity and actual raw
result/control byte counts. Successful facts remain unavailable until original
closes, post-close named checks and final cancellation/deadline fences succeed.
Native bigint device/inode/timestamps remain exact decimal strings. The bounded
private object contains no descriptor and grants no source/publication authority.

## Local evidence

Darwin arm64, Node26.7.0:

- `npx vitest run agent/test/output-collection --maxWorkers=1`: exit0,
  67 tests/6 files. Native filesystem checks compare actual lengths/root facts;
  held and failed descriptor closes cannot publish successful custody.
- A valid raw result file exactly1MiB is accepted with exact budget and rejected
  one byte below it. Canonical sealed content remains distinct from raw length;
  no raw-file digest equivalence is asserted.
- Node TypeScript, scoped output/controller-fixture ESLint, architecture1220 and
  docs191 checks: exit0. Independent source review found no blocking issue.

The previous full event verification predates this production change. A new full
verification and affected controller checks remain required on the composed
candidate. These scoped passes do not establish that full pass.

The [verified source proposal](../design/lld/output-source.md) still requires exact
trusted observations, durable source receipts, journal/retention quotas, replay,
release gating, range transfer and backend adoption. Existing controller test
collectors provide explicit synthetic facts; they are not filesystem or durable
source receipts. No complete engine/backend run or release qualification is claimed.
