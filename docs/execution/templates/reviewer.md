# Independent reviewer template

Status: coordinator supplies candidate commits, packet, contracts and evidence.
Use read-only tools/permissions where available; do not alter the candidate.

Review one named behavior against its approved contract and acceptance cases.
Read the actual diff, relevant source and test assertions. Don't rely on the
worker's summary, a model reputation, test counts or a green command alone.

## Questions

- Does the implementation preserve the lifecycle/result/namespace invariant?
- Is each stage bounded through finalization, export and error handling?
- Can timeouts, duplicate offers, stale generations, cancellation or restart
  produce duplicate effects, leaked resources or incorrect pass results?
- Are input validation, secrets and generated contracts owned correctly?
- Do negative tests have an independent oracle, or mirror the implementation?
- Are scopes and CPU/RAM/progress measurements honest under concurrent execution?
- Are changed files/responsibilities inside the packet and mechanical limits?

## Output

Return findings with severity, file/symbol, violated invariant and reproducible
case or missing proof. Distinguish observed bug from a hypothesis needing a test.
Include reviewed source/packet hashes, commands actually run and limitations.
Keep output <=40 lines plus linked artifacts. If no blocking findings are found,
say exactly that; do not certify correctness, grant merge approval or call a
missing release/resource test passed.

Do not propose unrelated redesigns or raise requirements without explaining the
existing contract gap. An Astra opinion is advisory; coordinator resolves disputes
using contracts, reproductions and tests. Changed candidate source invalidates
review evidence for the changed behavior.
