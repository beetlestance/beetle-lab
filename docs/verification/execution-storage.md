# Execution ownership and shared output storage

Status: implemented and locally verified storage foundation. Delivery transactions
and executable dispatch remain pending.
Reviewed corrected source: `89b38f3d57f85072f7842b0cc3ee8f896b05f530`.
Integrated verification source: `f47bf10321b64daa7e1329af30351e33ed829c69`;
the complete source trees are identical.

## Behavior

Application migration005 adds immutable compact enqueue costs, a stable queue
order and canonical installed-profile binding. Receipt replay keeps the original
Offer, registry and receipt bytes. Shared policy1 staging costs are calculated
once during the existing enqueue transaction, rather than while scanning history.
Existing rows stay unadopted. Indexed legacy possible-delivery and acknowledged
ownership witnesses block new claims independently of terminal public Run state.

Retained execution records bind the original intent, output reservation, bounded
remote snapshot and generation1 acknowledgment. Deferred foreign keys and guards
require reservation before possible delivery, actual possible delivery before first
ACK, and matched snapshot/generation before outbox deletion. Final admission proof
cannot be erased or replaced, before or after releasing execution capacity.
These guards do not implement the future observation merge transaction themselves.

Output reserves the declared maximum plus 65,536 metadata bytes using the same
installation usage counter as input uploads. Shared safe subtraction checks quota;
the helper requires a caller-owned transaction and uses actual database usage.
Inputs retain configured offline admission. Execution release never frees retained
output storage. Artifact adoption, settlement and retention remain separate work.

## Evidence

Independent SQL review found three defects in the initial submission: ACK before
possible delivery, replacement of final admission proof, and deletion of terminal
legacy ownership witnesses. All three were corrected and independently closed.
Identical regression test bytes produced 11 expected-rejection failures against
original guards, then 22 passes with corrected guards. Independent helper/quota
review found no blocking findings and revalidated the correction.

The final affected storage/domain run passed 98 tests across nine files. A later
test-call formatting correction passed its seven affected upgrade tests.
The integrated `NODE_OPTIONS=--max-old-space-size=1024 npm run verify:v2` exited 0:
3,677 tests/347 files in 457.44s, contract/API/k6 generation, all three type targets,
lint, architecture 1,066 sources, docs 172 pages and frontend build passed.
The existing 609.69kB frontend chunk warning remains. Synthetic loopback was enabled.

The Node24-target backend bundles built successfully. Compiled API smoke passed
pairing, namespaces, full-size suites, unavailable enqueue/scoped reads, input
publication/read/delete and SIGTERM. The frontend-controller smoke passed lost
create/chunk/seal replies, identical replay, offset resume, empty input, verified
downloads and logout against that backend. These use synthetic local HTTP fixtures.

## Limits

Evidence uses Node26.7/macOS arm64 and synthetic SQLite/local fixtures. Logical
payload accounting does not establish a hard whole-directory filesystem quota.
This source has no implemented DispatchStore scan/readOffer/claim/observe methods,
new executable delivery loop, real load, event ACK or result finalization proof.
Native Docker/Compose, amd64, supply-chain, resource and soak qualification remain.
