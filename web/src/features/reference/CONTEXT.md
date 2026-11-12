# Embedded public reference

Reference is a read-only route; catalogue.ts uses the generated public operation
and schema registry. Implementation status is source-owned; planned rows have
contracts but no shipped handler. Registration coverage is checked by the actual app. It resolves only included schema IDs/pointers, never fetches
an arbitrary schema URL. Query128chars, displayed80routes, inline schema64KiB
source/256KiB pretty; limit/error states remain explicit.

web/scripts/reference-assets.ts serves/emits the same fixed public resources in
Vite dev/build. Generated route reference is exported by contracts/api/reference;
no copied catalogue, runtime metadata, credentials or environment is read.
Binary guide shares real client/server route owners; k6 schema download shares
the existing structural source catalogue. Native image HTTP has separate tooling. Source
skill is web/integrations/beetle-lab/SKILL.md; MIT notice is appended to downloads.
Shared URLs belong to app/reference-downloads.ts, re-exported by routes. No test/installation mutation is performed.
Contract: docs/design/lld/embedded-reference.md.
