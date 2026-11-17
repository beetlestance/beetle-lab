# Documentation map

Each folder answers one question and owns its facts once
([decision 017](decisions/017-documentation-structure-and-delivery.md)).

| Folder | Answers | Changes when |
| --- | --- | --- |
| [system/](system/) | What is built now | The code changes, in the same commit |
| [plans/](plans/) | What will be built | The plan changes; deleted when it ships |
| [decisions/](decisions/) | Why a choice was made | Never; superseded by a new record |
| [evidence/](evidence/README.md) | What was measured, at which commit | Never; new evidence is a new file |
| [guides/](guides/) | How to install, operate and automate | User-facing behaviour changes |
| [engineering/](engineering/) | How to work on the code | The process changes |

## Start here

| Need | Read |
| --- | --- |
| Install or start | [Root README](../README.md), [development](guides/development.md) |
| What works today | [Capabilities](system/capabilities.md) |
| Open gaps and release state | [Backlog](plans/backlog.md) |
| Phases and direction | [Roadmap](plans/roadmap.md) |
| Architecture | [System overview](system/overview.md), then the [LLD map](design/LLD.md) |
| Code conventions | [Conventions](engineering/conventions.md), local CONTEXT.md |
| Required checks and platform scope | [Verification](engineering/verification.md) |
| Task execution and handoff | [Workflow](engineering/workflow.md) |
| Publishing | [Release](engineering/release.md) |
| Public automation | [Automation](guides/automation.md); API reference and skill download in the app |
| Capacity and backups | [Change capacity](guides/change-capacity.md), [backup and restore](guides/backup-and-restore.md) |
| Acceptance and historical proofs | [Acceptance ledger](evidence/acceptance-ledger.md), [evidence index](evidence/README.md) |

`design/` holds the LLDs until they are consolidated into `system/contracts/`
([plan](plans/active/docs-restructure.md)).

Authored pages stay within 180 lines, LLDs within 220, decisions within 80 and
CONTEXT.md within 40. Load only the contract your task needs.
