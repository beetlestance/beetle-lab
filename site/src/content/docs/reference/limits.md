---
title: Limits
description: Every fixed size, count and time limit a user can run into, in one table per area.
sidebar:
  order: 1
---

These limits are built in. Run budgets and capacity are separate: they are
settings, inherited from installation to organisation to workspace; see
[Organisations and workspaces](/concepts/workspaces/).

## Suites

| Limit | Value |
| --- | --- |
| Suite configuration | 1 MiB |
| Named requests per suite | 64 |
| Scenarios shown in the suite summary | 8 |

## Inputs

| Limit | Value |
| --- | --- |
| One input | 8 MiB |
| Upload piece | 64 KiB |
| Folder import | 128 files, 8 MiB each, 128 MiB in total, depth 8 |

## Request bodies and templates

| Limit | Value |
| --- | --- |
| Body, literal or rendered | 8 MiB |
| All content loaded by one run | 32 MiB |
| Template source | 4,096 characters |
| Template substitution | 65,536 characters |

## Runs

| Limit | Value |
| --- | --- |
| Attempts per run | 1; there is no automatic retry |
| Grace after a cancel before the engine is forced to stop | 5 s |
| Live metric refresh | about every 2 s |
| Live snapshot shown as current | up to 6 s old |
| Runs in one comparison | 2 to 4 |

## Target readings

| Limit | Value |
| --- | --- |
| Sampling interval | 1 to 60 s |
| Concurrent sampling requests | 1 |
| Reply size | 64 KiB |
| Samples per run | 256 |

## Automation client

| Limit | Value |
| --- | --- |
| Request file | 4 KiB |
| `--wait-ms` | up to one hour, checked every 2 s |
| Session lifetime | up to 8 hours |
