# Contextual command search

Status: F16 implementation contract; appearance follows the current shell.
This is functional navigation, separate from the deferred UI redesign.

## Commands and scope

Open with the shell button or Control/Command+K. Commands navigate only; they never
create/cancel a run, mutate metadata or choose a target/budget. Static destinations
come from the existing route registry. Context uses those same organisation and
workspace patterns plus UUID validation. An invalid workspace address cannot
fall back to another inferred namespace. Root views offer global destinations.

In an organisation, include its first workspace page. In a workspace, additionally
include its first suite/run pages. Each page is at most100 items; filter locally
with at most128 characters and display at most40 results with the full match count.
Names are React text, IDs become URLs only through existing route builders. This
is contextual navigation/recent-item search, not full-history/global full text.
The first-page limit and unavailable/more-page states remain visible.

## One query owner

Use the same QueryClient, generated client and exact first-page100/empty-cursor
keys as ordinary list views. Central page-key helpers own suffixes. No separate
cache, search endpoint, query-per-keystroke, background polling or automatic retry.
Reuse loaded pages without mount refetch; explicit refresh/retry is a bounded read.
Do not present a failed group's cached data as successfully refreshed results.
Existing public client binds page and item scopes before use. Disabled/invalid
contexts issue no requests. Closing retires palette observers without cancelling
another active observer of the shared resource. Existing scope owners retain
cache cancellation/cleanup; no cross-scope cache key or result is reused.

## Modal lifetime and keyboard

Capture the invoker before making the application background inert. One labelled
aria-modal dialog owns initial input focus, Tab wrapping, arrows among results,
Enter activation and Escape/backdrop/close dismissal. A focus-in fence returns
unexpected external focus to the dialog. Do not intercept composition/repeated
shortcuts or steal focus from another modal editor.

Visibility binds to the router location key at open. A route change immediately
unmounts the old palette before another scope's query effects can run. Late old
reads cannot render or navigate. Cancel restores a connected invoker; navigation
focuses the persistent main landmark after commit. Logout/unmount removes global
listeners and never focuses disconnected nodes. No draft editor state is reset.

## Acceptance

Test keyboard/button opening, filter/Enter/arrows/Tab/Escape and focus restoration;
route/scope/unmount retirement; literal bounds, first-page/more/error states,
wrong-owner replies before render and no mutation calls. Prove the same resource
key/request shares a pending original and closing search preserves a list observer.
Use scoped frontend types/lint/architecture/docs and one source web build. Native
browser modality is a separate qualification: JSDOM lacks native dialog methods,
so do not replace them with a fake browser success or claim release acceptance.
