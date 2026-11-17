# Published run artifacts

Public entry: `RunArtifacts({run, terminal, heading?})` (Run result / Artifacts). The caller selects scoped Run and
requested attempt; the internal keyed surface retires on identity changes.
Generated listRunArtifacts owns schema, cursor, manifest and scope validation.
One queryKeys.runArtifacts entry retains only the current <=100 descriptor page.
Refresh starts at the first page; next uses the canonical returned cursor.
Manual reads never overlap; pending polls every two visible seconds, while ready,
absent and errors stop. A terminal transition waits for the original pending read
before one refresh. Retirement aborts/removes the exact query and fences replies.
RunDetail composes the feature with requested scope and authoritative attempt.
Only publication metadata grants links, derived by runArtifactContentPath.
Relative paths are text; shared artifactDownload sets fixed UUID names and safe
txt/CSV/JSON extensions for known kinds, bin otherwise; no engine filenames.
Browser owns bytes, save/progress/cancel; links create no completion state or byte
client/cache. Already-issued native transfers remain browser/server owned.
Table: File / What it holds (static map by kind) / Size / Verify and open.
ArtifactViewer (Overlay / Artifact viewer) opens text kinds up to 1 MiB through
the shared VerifiedArtifactReads; content shows only after size and SHA-256 match.
Checks: node ../../../node_modules/vitest/vitest.mjs run
web/src/features/runs/artifacts --maxWorkers=1 (from assigned worktree root).
