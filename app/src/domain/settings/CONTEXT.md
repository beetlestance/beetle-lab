# Settings semantics

Public entrypoint: `index.ts`; application entrypoint: `../../application/settings/index.ts`.
Structurally validated schema-derived API inputs; no Node/framework/runtime effects.
One defaults resolver applies installation, organisation, workspace, suite revision,
run, then rejects policy/capability excess. API effective views stop at workspace.
Retention inherits only installation/organisation/workspace; setup defaults manual.
Null patches remove overrides; omission preserves; installation groups replace whole values.
Pool output is aggregate accounting, storage includes its free-space reserve;
output plus reserve must fit storage, and per-run ceilings must fit the shared pool.
Unknown runtime ceilings fail. Accounting does not claim runtime hard enforcement.
Snapshots are copied and deeply frozen. Lowered pool limits emit a drain signal;
admission owns its delivery, existing reservations and active work lifecycle.
Ports require one scoped intent/version/ancestor-read/validate/write transaction.
Commands are serializable; storage workers invoke exported decisions locally.
Retention execution, protected candidates, preview/apply/cursor protocols and recovery
belong to later storage work; PATCH has no deletion or execution port.
Check: `npx --no-install vitest run app/test/domain --maxWorkers=2`.
