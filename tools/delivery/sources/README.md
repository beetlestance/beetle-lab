# Distribution sources and notices

This release-only tool collects source and license material for an already staged
candidate. It does not run upstream build scripts, rebuild images or publish.
Normal Beetle Lab installation still uses Docker Compose.

```sh
node --import tsx tools/delivery/sources/collect.ts STAGED_DIRECTORY NEW_OUTPUT_DIRECTORY
```

Use absolute paths. Node, Git, curl and Python 3 are required. Output is private
until the publisher verifies it. A failed partial directory is never authority.

The committed catalog records complete Alpine recipe trees, file modes/Git
hashes, upstream SHA512 inputs and Node/nginx/k6 source archive hashes. Node's
source hash was checked against its official release SHASUMS. k6's commit came
from the unmodified ARM64 binary's Go build info; that observed binary hash is
explicitly ARM64, not a cross-platform binary identity. The pinned k6 base and
both platforms' scanned Go module versions must match.

Coverage checks every OS package origin/version and every runtime Node/nginx
version in the twelve staged image inventories. Candidate Git source and all
production lockfile npm tarballs are included; npm SHA512 SRI is enforced. Full
tarballs retain copyright/license files discarded by JavaScript bundling.

A catalog update is needed when base/runtime versions change. Fetch recipes at
the installed APK database commit, retain the complete Git tree and all original
source checksums, and independently review new pins. Never evaluate APKBUILD to
construct the catalog. One source symlink selects a verified regular sibling.

Downloads are sequential and counted within 512MiB total. Individual upstream
archives are capped at 200MiB, recipes at 2MiB and npm tarballs at 20MiB. Reports
use no-follow regular-file reads, exclusive writes, 5MiB per-file and 32MiB total.
The project Git archive is capped at 64MiB. The final source gzip is capped at
640MiB and 120 seconds. Partial output may coexist with unpacked inputs.

Packing uses bounded enumeration and normalizes owners, times and read modes;
executable recipe modes and safe sibling links remain. It writes neither host
usernames nor absolute paths into archive headers. A complete marker follows
successful process close and SHA256 verification. This supplies source material
and inventories; it is not a claim of reproducible component builds.
