# Wrapper failure values

Public entry index.ts. Owns the existing fixed AttemptReason/AttemptError vocabulary.
Shared by attempt orchestration and native artifact custody without an import cycle.
attempt/types reexports preserve the existing type/value identities.
No verdict mapping, diagnostics, IO, clocks or resource release lives here.
