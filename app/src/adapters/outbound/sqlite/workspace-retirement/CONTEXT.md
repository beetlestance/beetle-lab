# Workspace retirement
Migration028 retains FK-linked workspace originals and adds immutable retirement.
The canonical name stays unchanged; folded_name becomes a reserved private key.
Public HTTP access and namespace reads hide retired scope; user mutation commands
fence visibility before receipt replay. Exact workspace DELETE retains its ACK.
Private delivery/cleanup/settlement reads retain authority and paid storage.
Busy indexed predicates refuse active Run/export, charged execution and input intake.
Parent/manual/workspace retention previews and unissued Apply cannot mint authority.
Historical read-only mode has distinct visibility and still rejects writes.
Contract: docs/design/lld/workspace-retirement.md. Root owns migration028.
