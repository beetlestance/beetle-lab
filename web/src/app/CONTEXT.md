# Namespace shell

App accepts an ApiClient and host Router; production main uses same-origin fetch.
One QueryClient per App; queryKeys owns scoped resource identities and routes owns
URLs. UUID validation precedes every route-scoped read. No router data loaders.
No automatic retry, prefetch, previous-scope placeholder data, or fake API fallback.
Each list retains one active page; inactive prior pages are removed on navigation.
Cache GC is 60 seconds; page limit 100; cursor history 20. Scope departure removes
its remaining queries. UUID validation uses the public API schema, including URNs.
EditorProvider retains one draft across navigation and snapshots mutation intents.
Unknown results allow identical replay; editing begins a new request ID.
Settings routes lazy-load one feature; settings query keys include full scope.
Parent saves invalidate descendant effective settings; null removes scoped overrides.
Theme is the only persisted browser preference; no credentials are stored.
Check: npx --no-install vitest run web/src --maxWorkers=2.
