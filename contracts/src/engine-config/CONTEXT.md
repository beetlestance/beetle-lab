# Installed engine configuration contracts

Public entrypoint index.ts creates branded ConfigSchema from <=16 trusted schemas
and <=256KiB bundle, with synchronous <=1MiB config validation and content identity.
No remote schema loads, custom callbacks or admitted semantic compilation.
k6.ts uses shipped language-neutral sources, without engine implementation imports.
Its prepareK6SecretReferences translates <=64 declared aliases through the runner
secretReference schema, preserving optional versions and rejecting portable name
collisions, provider/path incompatibility and unknown fields. Bound128KiB before
traversal accommodates maximum escaped versions. Snapshot/freeze prevents mutation;
no secret lookup, resolved value, digest of secret content or filesystem/network I/O.
Application Offer construction and the staged engine wrapper share this translator.
Checks: contracts/src/engine-config and engines/k6/test/secret-bindings.test.ts.
