# Standalone script export controls

Entry ExportSavedRevision renders under a saved immutable revision. Installed
export mappings gate the form. Explicit resource/policy/build limits are submitted
through the checked public client. History and selected detail poll only while
nonterminal and stop on errors; downloads select only ready native publication.

The write hook retains one identical request across unknown outcomes. Scope/API
retirement aborts callbacks and ignores late replies; it never infers cancellation
of a durable job. Queries are scoped under workspace export keys and removed when
inactive after retirement. No UI redesign or performance Run is introduced.

Checks: web/src/features/exports/*.test.tsx.

## Script / revision overlay and workspace exports (package C)

- `ExportDialog.tsx` is "Overlay / Export script": Uses secrets (any
  `config.secrets` name or an `unsupported_secrets` reason; nothing is sent),
  Preparing (steps from the job state, elapsed time since `requestedAt`), Ready
  (file, size, SHA-256, scoped download) and Unknown (reserved output budget, never
  a guessed result), plus start and failed/cancelled states.
- `useRevisionExport.ts` finds the revision's newest job on one page of 100
  exports (the API has no revision filter), polls only live jobs, and builds the
  create request in `prepare.ts` from workspace run defaults, the first allowed
  installed profile and the default options.
- `scriptText.ts` reads a ready script once: one bounded GET of exactly the
  published bytes, SHA-256 checked, strict UTF-8.
- `ExportsTable.tsx` (`WorkspaceExports`) is the Exports workspace tab, mounted at
  `routes.exports` through the workspace scope route. Suite names come from one page of 100
  suites; revision ordinals from at most 32 reads.

Checks: `dialog.test.tsx`.
