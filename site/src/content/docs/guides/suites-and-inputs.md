---
title: Suites and inputs
description: Write suites, keep revisions, upload datasets and request bodies, and use templates.
sidebar:
  order: 1
---

## Suites and revisions

A suite has a name, a folder and a series of **revisions**. Each revision is an
immutable configuration; saving a change creates the next one. Runs, exports and
comparisons always refer to a revision, so changing a suite never rewrites
history. A configuration can be up to 1 MiB.

The suite page shows a summary of the selected revision (target origin, up to
eight scenarios with their executors and durations) and its latest run, with a
link to the suite's full history.

## Inputs

**Inputs** are files your suites read: datasets for parameterising requests and
bodies to send. They belong to a workspace and are immutable once published.

| Limit | Value |
| --- | --- |
| One input | 8 MiB |
| Uploaded in pieces of | 64 KiB |
| Folder import | 128 files, 8 MiB each, 128 MiB in total, depth 8 |

Upload goes through four visible steps: create, send bytes, seal, published. If
the connection drops, the upload pauses; nothing retries on its own. Check the
status, then resume from where the server stopped. Cancelling stops the upload but
can leave a partial input on the server, which the page tells you about.

An input that a revision uses is **pinned** and cannot be deleted until no
revision needs it. Downloads are verified (size and SHA-256) before the browser
offers the file.

## Request bodies and templates

A request body can be literal text or JSON, or a template that fills values from
datasets and variables.

| Limit | Value |
| --- | --- |
| Body, literal or rendered | 8 MiB |
| All content loaded by one run | 32 MiB |
| Template source | 4,096 characters |
| Template substitution | 65,536 characters |

Content without `{{` delimiters is sent byte for byte. Content with them is
treated as a template and checked against the template limits.

## Secrets

Suites refer to secrets by reference; values never appear in the configuration,
in comparisons or in exported scripts. A revision that needs a secret cannot be
exported as a standalone script.

## Settings that shape runs

Run budgets, capacity and retention are set at installation, organisation and
workspace level, each narrowing the one above. A run's budget must fit the
effective settings and the installed engine's ceilings.
