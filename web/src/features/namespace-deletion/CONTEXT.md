# Namespace deletion controls

Penpot "Overlay / Delete workspace" and the retire dialogs. `DeleteNamespace`
(props `target`, `refresh`, `disabled`) is the row action on namespace lists;
`RetireWorkspace` is the panel on Settings / Workspace (reads the workspace once for
its name and version). Both open `ConfirmDeletion`: type the exact name to enable
the action. One request ID per confirmation; only an unknown outcome is replayed,
with the identical versioned body. Beetle owns refusals (live workspaces, unfinished
work, a non-empty folder) and the dialog shows its message as returned.
No cascade, automatic retry, polling or new cache. Root folders disable deletion.
Not built: "What stays" counts and the list of unfinished work in the refusal
(the error carries no such list).
Check: vitest run web/src/features/namespace-deletion.
