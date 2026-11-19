# Compose packaging setup

Entry index.ts captures explicit Compose values, prepares the finite empty mount
skeleton through retained descriptors, drops socket/runtime identity and owns a
separate bootstrap lock. Fresh initialization delegates to the offline provisioner;
ready checking reuses shared configuration/image-pin validation without Journal IO.
Arguments `upgrade [action]` run the explicit offline upgrade (../upgrade/) under the
same home and gate; the home may then also hold `upgrade/`. Moved images print the command.
An existing root's request keeps its baseline settings and policy before the gate
opens (../src/installed-request.ts, decision 031); changed recorded bindings print
`binding_changed` with fixed names and a fixed hint. options.ts admits a non-loopback
origin/bind only with BEETLE_ACCESS=network and HTTPS (decision 032); a changed origin is `external_origin`.

home.ts owns canonical private directories; gate.ts serializes only configuration
preparation, never engine authority. Partial/conflicting state is preserved. No
recursive permission repair, token replacement or authority fallback is allowed.

The lock outlives file originals and cleanup. Root capabilities are used only to
prepare empty directories and drop privileges; existing non-root startup follows.
Contract: docs/system/contracts/installation.md.
Checks: tools/install/test/compose*.test.ts and explicit native Compose qualification.
