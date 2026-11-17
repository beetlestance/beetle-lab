# Workspace input screen

WorkspaceInputs composes the public input features under the existing API and
transfer contexts. Header actions open Upload files, Add a sample file and Import a
folder as dialogs; closing one retires its draft. Without a transfer client they
stay disabled. Inventory owns selected status/deletion and the download
slot; upload owns its separate local prepared intent. Scope/client departure
retires both components. This view creates no clients, credentials or side effects.
Check: scoped input feature and app navigation tests, then web TypeScript/build.
