# Decision 025: Standalone export is a distinct admitted purpose

Status: accepted. Recorded on 17 November 2026 from the design the code
implements; the choice predates this record.

## Decision

Generating a portable k6 script is its own job type, not a performance Run and not
a backend task. A closed `StandaloneExportAssignment` wraps an unchanged Offer and
is rejected by performance intake. The agent stores an immutable execution purpose
with the accepted Offer, stages `assignment.json`, and dispatches only to an
installed image that advertises `standalone-export-v1`. The engine compiles and
builds with the same compiler and builder used for execution, inside the admitted
container, and seals a separate `StandaloneExportResult` under its own prefix.
Metadata keeps export rows apart from Runs and shares queue, capacity and storage
accounting with them.

## Why

The script must carry the exact semantics the engine would run, so the build has to
use the one compiler and builder. That work consumes CPU, memory and disk, so it
needs the same admission, staging and physical-stop custody as a test, but it must
never contact a target or produce a pass/fail verdict.

## Alternatives

- Compile in the backend: rejected. It needs a second compiler/builder copy in the
  application image and bypasses admission, resource charging and physical custody.
- Reuse the Offer and `EngineResult` with a flag: rejected. A JSON-selected codec
  lets ordinary performance intake be steered into export (or back), and an
  export success could be read as a passed test.
- Model exports as synthetic Runs: rejected. Run history, comparison, retention and
  event bindings would all need to skip them, and a Run implies a target workload.
- Export with resolved secrets: rejected. It would copy secret values into a
  downloadable file; declared secrets are refused instead.

## Consequences

Agent Journal migration 015 and metadata migration 015 add purpose and export rows.
Recovery must reconstruct the original purpose and runtime spec; there is no
performance fallback. Images without the export capability cannot serve exports.
Secret-bearing suites cannot be exported until a separately reviewed mode exists.
