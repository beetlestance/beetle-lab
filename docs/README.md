# Documentation map

Start with the current status and read only the contract needed for your task.
Historical execution reports are preserved in Git, outside the maintained working
set. Their old progress statements do not describe current product readiness.

| Need | Read |
| --- | --- |
| Install or start | [Root README](../README.md) |
| Current capabilities, gaps and release status | [Current status](STATUS.md) |
| Product scope and delivery phases | [Plan](../PLAN.md) |
| Existing feature inventory | [Historical inventory](current-features.md) |
| Acceptance requirements and evidence links | [Acceptance ledger](verification/final-acceptance.md), [audit corrections](verification/audit-corrections.md) |
| Architecture and owning contracts | [HLD](design/HLD.md), then the relevant LLD |
| Code conventions | [Engineering](engineering.md), local CONTEXT.md |
| Required checks and supported platform scope | [Verification](verification.md) |
| Task execution and handoff | [Execution](execution/README.md) |
| Public automation | [Automation](automation.md); API reference and skill download in the app |
| Historical proofs, plans and failures | [History index](HISTORY.md) |

One rule has one owner. Keep current status in STATUS.md, architecture in HLD/LLDs,
and exact execution facts in linked evidence. Use historical documents when their
specific source/platform record is needed; do not load the entire archive for a task.
Authored pages stay within 180 lines, LLDs within 220, and CONTEXT.md within 40.

[Installed run memory](installed-memory.md) describes the supported offline increase.
