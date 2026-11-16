# Compose packaging setup

Entry index.ts captures explicit Compose values, prepares the finite empty mount
skeleton through retained descriptors, drops socket/runtime identity and owns a
separate bootstrap lock. Fresh initialization delegates to the offline provisioner;
ready checking reuses shared configuration/image-pin validation without Journal IO.

home.ts owns canonical private directories; gate.ts serializes only configuration
preparation, never engine authority. Partial/conflicting state is preserved. No
recursive permission repair, token replacement or authority fallback is allowed.

The lock outlives file originals and cleanup. Root capabilities are used only to
prepare empty directories and drop privileges; existing non-root startup follows.
Contract: docs/design/lld/compose-first-boot.md.
Checks: tools/install/test/compose*.test.ts and explicit native Compose qualification.
