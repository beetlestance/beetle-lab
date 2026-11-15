# Immutable candidate plan

This local preparation step performs no registry writes and never rebuilds images.
It uses the pinned regctl 0.11.7 binary with owned empty credential/config paths.

```sh
node --import tsx tools/delivery/registry/plan.ts STAGED SOURCES NEW_OUTPUT REGCTL
```

All arguments are absolute paths. Stage and source records must be complete and
match the exact candidate revision and all twelve config digests. Their archive
bytes are hashed again at this boundary. Run the tool in one exclusive process;
its private environment is configured for its own regctl/Docker configuration.

The source OCI index has six repeated short `transport` tag annotations. Imports
therefore select each original OCI manifest by digest, matched to its qualified
config, rather than by tag. Raw imported manifest/config hashes, platform and
revision are checked. Six role indexes must each contain precisely their AMD64
and ARM64 manifests. Source, revision and documentation annotations accompany them.

`publication-plan.json` contains public identifiers, expected manifests and source
archive identity. It contains no local paths, credentials or command logs. It is
written only after the complete local plan verifies. Private tool/config/layout
files must never be uploaded wholesale. Publish only explicitly selected safe files.

A registry writer still needs fresh source-run validation, public source readback,
conflict refusal, exact digest preservation and remote readback. Anonymous native
pull/Compose execution is a separate gate. Existing source/native acceptance is
not publication authority. See [image delivery](../../../docs/verification/rewrite-image-delivery.md).
