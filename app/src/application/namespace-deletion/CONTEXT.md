# Namespace deletion
Empty-only versioned deletion of scoped organisations/workspaces/nonroot folders.
Inputs: validated intent plus digest/store. Output: exact immutable deletion receipt.
No native IO, cascade or storage credit. Unknown commits replay the same intent.
Storage owns transaction, emptiness checks, permanent funded marker and receipt.
Tests: app/test/storage/namespace-deletion.test.ts and HTTP namespace cases.
