# Artifact publication reads

Public entrypoint: RunArtifacts and wire capture functions in index.ts.
Input: scoped Run key and exact requested owned attempt, plus bounded page or artifact ID.
Output: immutable publication page <=73728 bytes or closed {record:OutputFileRecord,kind} reply <=4096.
One transaction resolves the Run, requested attempt, shared verified source and <=128 slots.
Kind is read from its corresponding validated manifest descriptor, never a slot
filename. Native OutputFileRecord stays unchanged and has no presentation field.
Only matched finalization and complete published custody grants ready; matched absence grants absent.
No writer, ACK, accounting, publication, cleanup or native file effect occurs here.
Invalid requests fail invalid_input; foreign ownership fails not_found; contradictory evidence fails closed.
The worker retains original ownership through reply validation and bounded serialization.
Focused checks: app/test/run-artifacts/metadata.test.ts, absence.test.ts and native.test.ts.
