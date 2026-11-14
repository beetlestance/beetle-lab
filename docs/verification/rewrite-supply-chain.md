# Rewrite candidate supply chain

Runtime candidate: de4f908. Local Linux/arm64 evidence only. Registry publication,
anonymous pull installation and hosted native results remain unqualified.

## Implemented gate

After native Compose qualification, each native CI job installs official Trivy
0.76.2 with a pinned architecture-specific archive checksum. It scans all six
qualified local image IDs; revision, OS and architecture must match first.
No scanner registry fallback or rebuild can silently substitute another image.

Separate vulnerability and license JSON inventories preserve findings. CycloneDX
SBOMs and exact image metadata accompany them. HIGH/CRITICAL vulnerabilities fail
the gate, including unfixed findings; there is no vulnerability ignore list.
License classifications remain review evidence, independently of the CVE gate.
Trivy convert's scanner flag changes presentation, not all exit-code inputs, so
combined license/vulnerability JSON must not feed the vulnerability exit gate.

Bundled JavaScript is not reliably catalogued by image scanning. A separate npm
production audit and lockfile-based CycloneDX graph cover declared dependencies.
This is a conservative source inventory, not an exact map of bundled code or proof
that every component/license was detected. Audit HIGH/CRITICAL failures remain
failures while image inventories are collected. Tool/scan errors fail closed.
CI uploads reports for 14 days, excluding scanner caches and installation data.

## Local findings and correction

The retained 9c326f4 images had six HIGH vulnerability findings in each Node control
image and 24 in each k6/export image. The frontend had no HIGH/CRITICAL findings.
Node and k6 image indexes are now pinned to inspected upstream revisions; k6 2.4.0
matches both bootstrap profiles and the starter manifest. Runtime images omit
unused npm/yarn installations. Existing legacy images/publication are unchanged.

All six changed ARM64 image builds passed. Their actual vulnerability gate passed:
no HIGH/CRITICAL findings, production npm audit zero findings. Medium findings and
unknown-severity findings remain visible; this is not a zero-vulnerability claim.
The scan database and complete raw reports are retained with private evidence.

Five shell integration cases check immutable IDs, all-role report collection,
source-audit failure, scanner failure, vulnerability failure and wrong architecture.
Affected starter/profile checks passed; types, lint, architecture, docs and
actionlint passed. A first SBOM attempt failed on worktree dependency links; using
the committed lockfile corrected it. A combined-license gate failure is retained.

## Limits and release prerequisites

The new stack's real Compose run completed a passing k6 run in durable metadata,
but its public polling request timed out. The harness failed and verified cleanup;
this is not accepted end-to-end native qualification. Resolve the request failure
and preserve the existing output-guard blocker before release acceptance.

k6's upstream AGPL license and source links are preserved separately from Beetle
Lab's MIT license. License inventories and links alone do not establish complete
third-party notice or corresponding-source delivery. Those delivery requirements,
immutable matched multiarch manifests and anonymous pull proof remain prerequisites
for publishing the rewrite. Existing local passing evidence is scoped to its older
candidate; no native matrix or publication claim follows from scanner success.
