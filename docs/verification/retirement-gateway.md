# Retirement gateway evidence

Status: private source-local transport verified; deletion scheduling/ACK/refund pending.
Base0d1412f. [Contract](../design/lld/retirement-gateway.md).

Real task-owned TCP verifies exact original body/headers and pending/cleaned200 replies.
Controlled existing native IO fixtures verify complete request-bound reply capture,
shared source admission before traps, detached expectations through held DNS, byte
limits and independent request/response/socket close custody through cancellation,
deadline and shutdown. No-evidence abort and unexpected statuses stay failures.

Initial18cases passed3.23s. Expanded runner integration153cases/13files passed8.32s.
Typecheck caught mutation tests using an owned readonly fixture; those tests now use
the mutable caller wire type. Production source was unchanged. Corrected22cases
passed1.72s; Node/frontend/runtime types16.18s, lint7.08s, architecture8.97s,
docs1.93s and API build1.03s exited0. Independent review accepted the source;
unaffected runner evidence is reused. Private check-runner records commands,
input identities, failures and timings. Tests use synthetic endpoints/receipts; they do
not prove native cross-service cleanup or durable backend ACK acceptance. Matched
arm64 image evidence at0f0afbb remains its separate normal-execution scope.
User services, targets, published images and storage accounting were unchanged.
