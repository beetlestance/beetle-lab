# Runner gateway

Public entrypoint: `createRunnerGateway(loaded): RunnerGateway`.
It captures private origin/token/installation and copies immutable attempt scope
including expected journalAuthority. Exactly one private authority header is sent;
that transport value never enters original Offer/config or logical reply matching.
Generated runner methods, shared bounded encoding, and shipped validators own DTOs.
Two Offer and eight ordinary original calls share credits across every facade.
No queue, retries, redirect, address fallback, proxy, keepalive or decompression.
DNS completes before one pinned address is used. Abort prevents late DNS delivery.
Calls retain DNS/request/response/socket ownership until actual native completion.
Close fences calls, aborts active requests, and retains one drain promise.
Requests: Offer <=2MiB, ordinary <=64KiB. Replies <=1MiB/4096 fragments.
Headers <=16KiB/32 fields. Logical deadline: 5000ms; it never releases credit.
Failures expose fixed typed categories; native exceptions/configuration stay private.
Capacity mapping and freshness remain the capacity adapter's responsibility.
Focused checks: `npx vitest run app/test/runner --maxWorkers=1`.
Internal `gateway`/`native` seams exist for controlled original-custody tests only.
