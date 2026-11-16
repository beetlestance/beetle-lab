# Durable namespace storage
Public index.ts owns installed/task namespace transactions and cleanup reserve checks.
Migration016 owns immutable singleton and task rows, raw SQL guards and admission
capacity. validation.ts registers bounded deterministic value checks on each worker.
Installed intent requires fresh history; old zero-control rows never acquire guessed
native authority. Binding and exact task anchors replay unchanged or conflict.
Installed singleton32KiB; task intent+anchor+512row allowance8KiB; admission reserves
196608 logical bytes/version1 for performance and export before reservation/event.
Actual native observations and startup token belong to staging, not these codecs.
Storage failures retain their errors; no cleanup removal, ACK, refund or purge here.
Owner docs/design/lld/staging-namespace.md; future cleanup-control.md/output-retirement.md.
Focused checks: agent/test/staging-namespace and affected Journal/admission tests.
