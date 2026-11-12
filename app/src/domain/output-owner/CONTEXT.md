# Output owner binding

OutputBinding is existing immutable EventBinding for Runs, or an explicit closed
standalone_export binding with exportId/attempt/Journal authority and compact result
expectation. No export is persisted as a Run. Existing Run identity bytes remain
unchanged; native exports use a separate namespace/identity domain.
Capture uses own data fields and requires expectation/scope/attempt agreement.
No storage, transport, lifetime, admission or producer authority is created here.
