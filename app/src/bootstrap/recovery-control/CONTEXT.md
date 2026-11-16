# Backend offline/startup exclusion

Explicit initialization creates a private <=64KiB control database. Serving startup
acquires ready state before metadata/input/runtime IO and holds an EXCLUSIVE lease
through original cleanup. Loader-configured production applications require this
control; direct injected applications may omit it for isolated component fixtures.
Recovery can bind restoring state to an operation/digest; close never clears it.
This is a prerequisite, not supported backup/restore or a completion proof.
The offline coordinator must prove current physical/data quiescence, bind both
service gates plus a shared completion fence, and validate restored historical
custody/anti-replay authority before completing either gate. This module grants
none of those proofs. Control files stay outside replaced paths.
Tests: app/test/recovery/backend-control.test.ts and startup-control.test.ts.
