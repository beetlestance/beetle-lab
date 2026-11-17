# Installed configuration generation

Pure bounded receipt selector for serving and offline composition. A ready receipt
binds unchanged baseline bytes and, optionally, one complete committed generation.
A generation binds installation, operation, original request digest and all three
configuration objects. Invalid or unfinished receipts refuse configuration intake.
Each consumer still validates the selected configuration with its owning schema.
No filesystem, runtime authority, settings writes or token handling lives here.
The baseline provision request remains unchanged; generation selection is explicit.

Optional increase metadata binds capacity kind and amount into new generation
digests. Strict capture rejects unknown kinds/unsafe bytes. Old generations keep
their existing digest; maintenance restricts metadata-free replay to memory.
