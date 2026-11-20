# Standalone script export controls

Entry ExportSavedRevision renders under a saved immutable revision. Installed
export mappings gate the form. Explicit resource/policy/build limits are submitted
through the checked public client. History and selected detail poll only while
nonterminal and stop on errors; downloads select only ready native publication.

The write hook retains one identical request across unknown outcomes. Scope/API
retirement aborts callbacks and ignores late replies; it never infers cancellation
of a durable job. Queries are scoped under workspace export keys and removed when
inactive after retirement. No performance Run is introduced.

Checks: web/src/features/exports/*.test.tsx.

## Script / revision overlay and workspace exports (package C)

- `ExportDialog.tsx` is "Overlay / Export script": Uses secrets (any
  `config.secrets` name or an `unsupported_secrets` reason; nothing is sent),
  Preparing (steps from the job state, elapsed time since `requestedAt`), Ready
  (file, size, SHA-256, actual seal time, verified download) and Unknown
  (last recorded changed agent report, reserved output budget, never a guessed
  result), plus start and failed/cancelled states. Missing times say Not recorded.
  Both preparing and unknown dialogs preserve identical cancellation replay.
  Desktop overlays are 620 px; phones use the shared bottom sheet.
- `useRevisionExport.ts` reads the exact scoped latest revision export, follows
  newly created jobs, stops polling on errors, and builds the
  create request in `prepare.ts` from workspace run defaults, the first allowed
  installed profile and a script time limit from the captured workspace run timeout.
  Ready shows the persisted limit; Prepare again creates a new job, preserving old files.
  Limits over 48 hours are refused rather than clamped; unknown replays keep their intent.
- `script-bytes.ts` captures published size/hash/path; inline scriptText stays at 1 MiB,
  downloads at 64 MiB. One original, no queue; 30 s abort retains cleanup/hash work.
- VerifiedDownload saves checked bytes as plain JS or a ZIP containing only script.js.
  One global URL; retirement aborts and revokes. Nothing is read until requested.
- `ExportsTable.tsx` (`WorkspaceExports`) is the Exports workspace tab, mounted at
  `routes.exports` through the workspace scope route. Suite names come from one page of 100
  suites; revision ordinals from at most 32 reads.
- `RunExport.tsx` (result header **Export script…**) posts `createRunExport` once per job,
  follows it and reuses `parts.tsx` with the revision dialog. Checks: `run-export.test.tsx`.
