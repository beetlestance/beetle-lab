# Namespace deletion controls

Penpot "Overlay / Delete workspace" and the retire dialogs. `DeleteNamespace`
(props `target`, `refresh`, `disabled`) is the row action on namespace lists;
`RetireWorkspace` is the panel on Settings / Workspace (reads the workspace once for
its name and version). Both open `ConfirmDeletion`: type the exact name to enable
the action. One request ID per confirmation; only an unknown outcome is replayed,
with the identical versioned body. Beetle owns refusals (live workspaces, unfinished
work, a non-empty folder). An organization conflict with reason `active` shows one page of
active workspace names and links to the directory. Other refusals show the server message.
No cascade, automatic retry or polling. Root folders disable deletion.
Not built: "What stays" counts and the list of unfinished work in the refusal
(the error carries no such list).
Check: vitest run web/src/features/namespace-deletion.
