# Run artifact controls

Status: accepted UI implementation contract. Consumes
[artifact metadata and content](run-artifact-downloads.md); no new storage or API.

## Inventory owner

RunDetail composes RunArtifacts for the requested Run's scoped active attempt,
keyed by organisation/workspace/run/attempt. Use the generated listRunArtifacts
client and a single registered TanStack Query key beneath the run/attempt.
One current page, limit100, is retained; do not append pages or payloads to cache.
A bounded next-page control uses the returned canonical cursor. Refresh returns to
the first page. Never combine pages from different attempts/manifests. The existing
client's semantic binding checks remain required, including pending/absent states.

Display loading, pending publication, source-free absence, ready inventory and
read failure distinctly. An empty ready page is not source-free absence. Show
kind, bounded relative filename as text, byte size and SHA for ready descriptors;
relative paths never become a URL or download filename. React escapes all text.
A single page holds at most100 descriptors/73,728 wire bytes; no full run corpus.

Poll pending publication every2s only while visible. Stop automatic polling on
ready, absent or error; error recovery is explicit. Do not infer readiness from
terminal Run state. A terminal transition waits for any outstanding original read
and then refreshes once if still pending. Page/refresh actions never overlap an
issued query; use cancelRefetch:false and disable controls while fetching.
A late old-page response must not overwrite a new page or scope. On retirement
abort/remove the exact query; session replacement already remounts the app.

## Browser-owned content

Use a same-origin anchor derived only by runArtifactContentPath from validated
scope/run/attempt/artifact UUIDs. Attachment name is artifact-<UUID>.bin, matching
the backend. No URL credentials, engine path, query/hash, external navigation,
fetch/blob buffer, client-side payload cache or new transfer/session owner.
GET uses the existing local session cookie; no mutation CSRF header is required.
Do not change the Host/Origin/session guard or public route to support a link.

The browser owns the transfer/save UI and cancellation. The backend still admits
one native read and verifies full SHA, exact length, physical custody and native
settlement before successful HTTP EOF. Clicking a link is not proof of download
completion, a saved file or an independent browser digest check. Show no synthetic
success/progress, retry loop, verified-local badge or retained completion state.
Provide a brief statement that download progress and cancellation are in the
browser. Session/scope changes remove the link; an already issued browser transfer
remains browser/server-owned, bounded by the existing server lifetime/deadline.
An expired session or server error is handled by the browser response; inventory
errors still use the paired generated JSON client. Do not fake session recovery.

## Presentation and acceptance

Use existing theme tokens, typography, buttons, notices and focus treatment.
Label region and per-artifact links clearly. Native keyboard navigation suffices;
keep tables/lists scrollable at narrow widths and hashes wrapping. Honour existing
reduced-motion policy; no additional animation package or brand asset needed.

Test real RunDetail composition with the generated client, canonical paged data,
pending/absent/ready, truthful empty-ready state, errors/manual retry, historical
attempt selectors at the component boundary, scope/session/unmount and held-read
retirement, manifest/page changes, terminal-refresh and no overlapping reads.
Assert exact same-origin five-UUID href/download filename, escaped path text,
no content fetch/blob buffering and no completion claim after activation.
Preserve affected Run test assertions; extend their shared fixture only with
schema-valid default pending artifact pages, excluding that specific read where
an existing test counts an unrelated operation. No broad catchall mock routes.
Run focused UI tests, affected Run composition, changed lint and web types.
Coordinator independently reviews source and one composed seam; no full build,
Docker or repeated unchanged backend verification. Real-browser save/viewport
qualification remains separate if browser tooling is unavailable.
