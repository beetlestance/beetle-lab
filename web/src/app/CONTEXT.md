# Namespace shell

App accepts an ApiClient and host Router; production main mounts SessionApp with
the same-origin URL. The session feature verifies access before App mounts and
retires its requests, cache and editor state on session transitions.
One QueryClient per App; queryKeys owns scoped resource identities (including
installationStatus, runQueue, runLatencyAttribution, pinned runsPage)
and routes owns URLs. `shell/WorkspaceTabs` is the one workspace section bar (Suites, Runs, Inputs,
Exports, Workspace settings). UUID validation precedes every route-scoped read. No router data loaders.
No automatic retry, prefetch, previous-scope placeholder data, or fake API fallback.
Each list retains one active page; inactive prior pages are removed on navigation.
Cache GC is 60 seconds; page limit 100; cursor history 20. Scope departure removes
its remaining queries. UUID validation uses the public API schema, including URNs.
EditorProvider retains one draft across navigation and snapshots mutation intents.
Unknown results allow identical replay; editing begins a new request ID.
Workspaces opens the organization chooser or the current organization's workspace list.
The header switcher reads up to 20 organizations on demand and links to the full list.
Settings routes lazy-load one feature and always expose all three levels. The shell
remembers the current organization and workspace for Settings within the session.
Settings query keys include full scope. Page and tab entry honor reduced motion.
Parent saves invalidate descendant effective settings; null removes scoped overrides.
The Darkroom or Scarab skin is the only persisted browser preference; no credentials.
SessionApp also supplies InputTransferClient through InputTransferContext. Omitted
transfer clients in composition tests cannot produce enabled transfer controls.
SessionContext (app/session.tsx) carries the verified session's readOnly and
restoredBackup; SessionApp supplies them from its one session read and features use
useSessionAccess, never getBrowserSession. App without a session prop is writable.
Check: npx --no-install vitest run web/src --maxWorkers=2.
