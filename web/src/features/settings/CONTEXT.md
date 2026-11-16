# Settings

Inputs: validated installation/organization/workspace route scopes and required ApiClient.
Outputs: effective defaults, provenance, actual overrides and explicit editor intents.
Effects: six typed GET/PATCH methods; shared EditorProvider owns draft/replay state.
Limits: schema-bounded settings, safe canonical integers and atomic retention policy.
Installation groups replace complete snapshots; scoped edits send selected leaves only.
Null explicitly removes an override. Effective values never seed inherited edits.
Failure/cancel: query AbortSignal, exact departure removal, no retry or placeholders.
Parent writes invalidate descendant settings; refresh never overwrites retained drafts.
Workspace retention controls are separately owned by ../retention/CONTEXT.md.
No profile installation, credentials or persisted settings cache.
Check: NODE_OPTIONS=--max-old-space-size=1024 npx --no-install vitest run web/src --maxWorkers=2.
