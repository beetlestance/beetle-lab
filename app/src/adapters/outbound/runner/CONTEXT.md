# Runner gateway

Public entrypoint: `createRunnerGateway(loaded): RunnerOutputGateway`.
It captures private origin/token/installation and copies immutable attempt scope
including expected journalAuthority. Exactly one private authority header is sent;
that transport value never enters original Offer/config or logical reply matching.
Generated runner methods, shared bounded encoding, and shipped validators own DTOs.
Two Offer and eight ordinary original calls share credits across every facade.
The output facade uses a maximum-two source subset of those same eight ordinary
credits, acquired before request capture and retained through original native close.
No queue, retries, redirect, address fallback, proxy, keepalive or decompression.
DNS completes before one pinned address is used. Abort prevents late DNS delivery.
Calls retain DNS/request/response/socket ownership until actual native completion.
Complete valid EOF is retained through abort/deadline and cleanup errors while
resources drain; schema/identity/status validation must still succeed before a
positive reply escapes. Incomplete/malformed evidence never becomes positive.
Close fences calls, aborts active requests, and retains one drain promise.
Requests: Offer <=2MiB, ordinary <=64KiB. Replies <=1MiB/4096 fragments.
Source chunk requests <=1024 bytes. Source envelope/chunk native replies allocate
and admit at most75776/90112 bytes respectively, before parse. Shared source codecs
verify manifest/result integrity, exact original binding/receipt and declared ranges.
The caller supplies one verified artifact's byte length; no manifest cache is held.
Headers <=16KiB/32 fields. Logical deadline: 5000ms; it never releases credit.
Failures expose fixed typed categories; native exceptions/configuration stay private.
Capacity mapping and freshness remain the capacity adapter's responsibility.
Focused checks: `npx vitest run app/test/runner --maxWorkers=1`.
Internal `gateway`/`native` seams exist for controlled original-custody tests only.

Live reads use two of the same ordinary credits, separate from source transfer;
fixed path,64KiB frame/freshness and late-abort checks follow actual native close.
