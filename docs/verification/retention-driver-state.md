# Advisory cleanup-driver availability

Public detailed batch status reports running/stopped/disabled/unknown only after
its scoped metadata lookup. The bound actual output-owner view and parent failure,
close and drain flags establish availability. Getter errors and invalid values map
to unknown; raw errors never enter the response. UI warns when cleanup is unavailable.

This is installation-wide advisory state. Running means the loop is available,
not that the agent is reachable or that a particular batch can progress. It cannot
explain individual funding/capacity refusals or preserve causes across restart.
Counts, completion and credit remain exclusively metadata-derived. No logging RPC,
native scheduling/failure/drain change, diagnostic row or migration was introduced.

11 focused owner/compiled-worker HTTP/UI cases passed. The broader lane passed421
cases and found an old composition mock missing two required factory capabilities;
the mock was aligned without changing production behavior. All22 affected output
owner/composition cases then passed, with no unhandled errors. Types, lint,
architecture, docs, API generation and API/web builds passed. Independent review
found no blocker.

Cases cover getter capture/replacement, failure before held close completes,
disabled embedding, unknown/error sanitisation, authentication/scope before getter,
unchanged credit/charges from advisory reads and actual partial settlement while
stopped. [Native retention recovery](native-retention.md) is qualified separately; its limits remain explicit.
