# Native private secret qualification

Use verified source images and a synthetic target with two random canaries.
Preserve immutable installer configuration/receipt. Explicit operator override
copies that configuration into a private UID 1000 file and adds exact scoped
bindings, an environment value and one read-only private mounted file.

Only owned helper/agent resources are touched. No credentials from the user.
Target compares digests; never echoes request headers. Audit all eight final
artifacts and public results plus bounded owned logs. Canary-bearing fixture and
override files are private evidence and must never be uploaded. Fixed audit
failures contain no actual canary. Cross-workspace reuse of identical names/versions must error before managed
engine creation and leave physical ready/work counts unchanged.

Three originals use an explicit32MiB output budget each (96 MiB total retained
within the stock128MiB pool); CPU/RAM/PID and all installation gates remain stock.
A released no-container setup failure still retains its output hold. Preserve
that debt and history; never enlarge the pool or silently refund it for the test.
