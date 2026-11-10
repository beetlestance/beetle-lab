# Collected output facts

Status: implementation candidate; independent acceptance required. This private
producer contract is the first step of [verified source](output-source.md), not a
journal source receipt, HTTP manifest or publication API.

## Success value

OutputCollectionResult success retains its existing immutable EngineResult and
verifiedBytes, and adds required immutable `custody`:

| Field | Meaning/bound |
| --- | --- |
| resultFileBytes | Actual raw engine-result.json bytes read;1..1048576 |
| controlBytes | Captured accepted-control byte count supplied by trusted controller;0..67108864 |
| root.directory | Captured canonical private directory;<=4096 UTF-8 bytes |
| root.uid | Expected and verified owner; safe integer0..4294967295 |
| root.device/root.inode | Exact native bigint decimal strings; no numeric conversion |
| root.modifiedNs/root.changedNs | Exact native directory mtimeNs/ctimeNs decimal strings |

The complete custody object serializes within32768 bytes. The root/file owner
captures identities from the same successfully checked root descriptor; it does
not reopen the path or infer identity from its spelling. Fields are owned scalar
copies; both root and custody objects are frozen. They contain no open descriptor.

The result file keeps its existing1MiB raw-byte limit. Valid whitespace may make
its raw byte length larger than the canonical EngineResult and its control frame.
The content seal is not a raw-file SHA256. No raw-file digest is claimed here.
Later source delivery will persist canonical verified result content separately
from the raw-file length used for native output budget accounting.

verifiedBytes remains actual raw result bytes +controlBytes +declared artifact
bytes under the original output budget. This change does not change hashing,
artifact path validation, read windows, limits or result verdict mapping.

## Lifetime and trust

These facts are published only with a successful collection outcome after every
original read and descriptor close has settled successfully, the named-file
post-close check passes and final cancellation/deadline fences pass. Failure,
pending/failed close, mutation or stop yields no successful custody object.

controlBytes is the controller's captured byte count. It does not prove a persisted
stopped_verified checkpoint or settled runtime by itself. A future trusted source
commit must bind the complete accepted checkpoint/launch/runtime observations and
wait the controller's existing originals/quiesced boundary. JSON fields cannot
prove filesystem operations or manufacture missing durable authority.

## Acceptance

Compare actual result-file length and native root bigint stats independently;
exercise raw/canonical length differences and exact output budgeting. Verify
owned immutable facts, zero/large artifacts and existing custody negatives. Hold
an original close and prove success/facts remain unavailable; reject close failure,
post-close root mutation and cancellation. Existing controller fixtures remain
explicit synthetic collectors, not source/publication authority. No durable source,
resource release, backend publication or terminal outcome follows from these facts.
