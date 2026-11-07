# Scoped settings use cases

Public `index.ts` exports mutation preparation/decision plus `getSettings`,
`getSettingsIdentity` and `patchScopedSettings`. Reader/store/digest effects are
injected; no framework, storage implementation or runtime effect lives here.
Queries freeze separate authority and effect copies before awaiting reads.
Settings responses are bounded to 64KiB, schema checked and scope checked;
every effective source must identify installation or a requested ancestor.
Identity responses are bounded to 2KiB with exact UUID/scope shape checks.
PATCH snapshots/validates the complete intent before identity I/O and delegates
receipt/version/transaction ownership to the existing mutation/store path.
Identity reads never resolve effective defaults, allowing original receipt replay
after runtime expiry. Fresh decisions still enforce runtime availability.
Only settings persist; composition must reconcile current effective policy before
admission. No retention apply, active-job changes or reliable propagation here.
Check: focused settings-query and HTTP settings integration Vitest files.
