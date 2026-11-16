# Contextual command search

Status: reviewed local F16 implementation; native browser qualification pending.
Base7ca7a73; source is the integration commit containing this report.
Contract: [command search](../design/lld/command-search.md).

## Implemented behavior

The existing shell button and Control/Command+K open a labelled modal. Users can
filter navigation commands, the current organisation's first workspace page and
the current workspace's first suite/run pages. Each source is limited to100 items;
queries are128 characters and at most40 matches are displayed with the total count.
The limit and further-page states are explicit. This is not full-history search.

Commands navigate only. Existing route builders and validated UUID contexts own
links. Query keys and100-item requests are identical to ordinary first-page views;
there is no second cache, per-keystroke request, automatic retry or polling loop.
Failed groups hide their failed cached items while navigation remains available.

The app background becomes inert. Input focus, Tab/arrow traversal, Enter, Escape,
backdrop dismissal and focus return are owned explicitly. Opening location keys
fence the palette immediately on route change; closing preserves other observers
of a shared request. Pending editor state stays mounted behind the palette.

## Evidence

Nine focused DOM/model cases passed in5.61s. They exercise button/shortcut opening,
focus containment/return, Tab/arrows, Enter navigation/main focus, Escape/backdrop,
input bounds, ignored composition/repetition and listener cleanup. Namespace cases
cover immediate route retirement, a late same-name old-scope response, rejected
foreign pages, explicit retry, more-page/error states and no requests while typing.

A held list response has one actual generated-client request shared by list and
search. Closing search leaves the other observer and its signal alive; the list
receives its original response. All observed runtime commands are GETs. Invalid
workspace identifiers produce global navigation context rather than another scope.

Related list/shell regression checks:45 passed in8.56s (8.99s wall time).
Frontend types passed in4.76s; the source web build passed in1.69s. Changed lint,
architecture and docs passed. The build emitted a large-chunk warning; no warning
threshold was changed. Initial lint found one group
function over the complexity limit; repeated boolean branches were factored without
changing gates or behavior. The independent review found no blocking defects.

## Limits

JSDOM does not implement native dialog methods. This implementation tests its own
explicit dialog/focus handling and declares native inert behavior; it does not fake
a native dialog test or establish real-browser accessibility/release qualification.
No Docker rebuild, user-service restart, performance workload, mutation or
publication occurred. Dashboard rollups, dropped-load guidance, producer cleanup,
final refund and remaining R4 gates remain separate work.
