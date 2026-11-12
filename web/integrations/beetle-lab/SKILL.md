---
name: beetle-lab
description: Configure and run HTTP performance tests through a local Beetle Lab v2 installation, inspect durable results, and generate standalone k6 scripts.
---

# Beetle Lab v2

Use the public HTTP API of the user's running local installation. This skill does
not install an MCP server or grant permission to test an additional target.
Preserve the target, workspace and resource budget authorized by the user's task.

## Read the installed contracts

Obtain the installation's exact configured origin, including its port. Fetch
`/reference/public-api.json` from that origin before choosing operations or payloads.
It contains generated JSON operations, binaryOperations, message references and
their JSON Schema catalogue. Binary entries supply content/upload paths, offset
query, media type, byte bounds and headers; do not guess missing transfer URLs.
Keep the full catalogue outside model context; extract only needed operations and
referenced definitions with your tools. Resolve `$ref` against included `$id` values. The human
reference is `/reference/public-api.md`; the application page is `/reference`.
These resources ship with the frontend and require no private repository access.

Use public `/api/v2` routes only. Never read the private agent credential or call
Docker or `/runner/v1` as a substitute for an unavailable public operation.

## Local session

Keep a same-origin cookie jar. In automatic local mode, exchange an empty JSON
body through `openLocalBrowserSession` with `X-Beetle-Local: 1` and an `Origin`
header equal to the configured origin. Keep the returned CSRF value privately and
send `X-Beetle-CSRF` on subsequent mutations. Send JSON Content-Type on exchanges.
Cookies and CSRF values must not enter output, URLs or source files.

A paired installation needs its explicit pairing flow; do not repeatedly mint or
guess tokens. A401/403 is an access failure. Host aliases can fail the exact-origin
check. Follow the supplied origin and do not probe other hosts or bypass guards.

## Configure and execute

Discover organisations/workspaces and select the requested scope. Read effective
settings and supported profiles before choosing budgets. Missing/stale capacity
is unknown, never zero usage or unlimited capacity. Lists are cursor-paged.

Create suites and immutable revisions through the generated operations. Supply
HTTP configuration matching `/reference/k6-config.json`, with scoped input references.
That download includes the root schemaId and all k6 configuration schemas. Use the input
transfer/seal workflow for files; existing secret references are resolved by the
installation, not embedded credentials. Raw shell hooks are unsupported.

Each logical mutation uses a new UUID requestId and any required expectedVersion.
Retain the exact body and requestId until its outcome is known. For a retryable
lost reply, replay that same command; never create a second run with a fresh UUID.
Limit automatic replay to one retry, then report the unresolved original.

After enqueue, retain the returned run/attempt IDs. Poll bounded reads with at
least250ms between polls; stop at the user's waiting deadline or100 reads. Report
pending/unknown honestly. Reaching a waiting deadline does not itself cancel the
job. Use explicit cancellation only when authorized by the current task.

Accepted/queued is not passed. Read the terminal result and artifact availability;
distinguish invalid configuration, engine error, cancellation and test failure.
Keep partial coverage and missing metrics visible when explaining results.

## Results and standalone generation

Use scoped artifact inventory/content routes. Bound downloads by declared size and
verify SHA256 before treating bytes as a verified artifact. Retain IDs and digests
across interruption; do not rerun target traffic to recover a missing download.

For a standalone script, discover export profiles and create an export for the
saved revision. Poll its own job and download its verified script. An export is a
separate offline job, not a performance Run. No export profile means unavailable;
do not invent an image or run shell commands as a fallback.

The installation is initially one local administrator. Hosted/LAN IAM, browser
E2E, mutation testing and generated test cases are separate future capabilities.
