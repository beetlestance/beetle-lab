# Container automation client

Public entry: runClient(argv,streams,optionalFetch) in main.ts; executable
app/dist/automation.js from build:api, already copied by the backend image recipe.
See docs/design/lld/automation-client.md for the closed commands and exit contract.
Optional container client; installation remains Compose-first. HTTP only, no
SQLite, agent, engine compiler, target requests or separate outcome calculation.
Connect uses the normal automatic local exchange without a token; pair consumes
the explicit paired profile startup token. Both share one strict cookie capture and
one exclusive private credential writer; never logs tokens/cookies/CSRF or re-pairs
an already-used paired installation. Connect requires explicit automatic mode. Strict source ownership/mode/byte checks.
Session files bind exact endpoint and configured loopback origin. The Node HTTP
adapter preserves Host (native fetch overrides it); no redirects/upgrades/retries,
headers16KiB, request4KiB, response queue64KiB and existing typed wire byte limits.
Commands validate the existing generated schemas. Run/cancel issue once with
caller-owned requestId; uncertain replies expose only fixed diagnostics/requestId.
Only explicit replay of the same request file is allowed, never auto retry.
Waiting uses monotonic deadline, sequential2s polling/max1801 and post-reply guards.
Late replies cannot upgrade timeout to passed. Output is one bounded JSON record;
separate1s stdio budget owns callback/error/close and backpressure cancellation.
Run without wait acknowledges submission; status/run-with-wait use authoritative
Run facts, including distinct cancelled/inconclusive/pending exits. Result may null.
Signals abort client work, not admitted engine jobs. No persistent cache/daemon.
Focused tests: app/test/client/cli. Native HTTP uses synthetic isolated backend,
files, credentials and worker; no load target or actual Docker engine invocation.
