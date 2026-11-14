#!/usr/bin/env bash
# Scan the exact locally qualified images; never rebuild, pull or publish them.
set -euo pipefail
revision=${1:?revision required}
architecture=${2:?architecture required}
scanner=${3:?absolute scanner path required}
output=${4:?new output directory required}
prefix=${5:-beetle-candidate}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
[[ "$architecture" == amd64 || "$architecture" == arm64 ]]
[[ "$scanner" == /* && -x "$scanner" ]]
[[ "$prefix" =~ ^[a-z0-9][a-z0-9-]{0,80}$ ]]
[[ ! -e "$output" ]]
mkdir -m 700 -p "$output"
output=$(cd "$output" && pwd -P)
export GOMAXPROCS=2
export TRIVY_CACHE_DIR=${TRIVY_CACHE_DIR:-"$output/cache"}
"$scanner" --version > "$output/scanner.txt"
status=0
# Bundled JavaScript is not reliably catalogued from images. Retain a separate
# production dependency graph/audit; do not claim image scanning covers it.
npm sbom --omit=dev --sbom-format=cyclonedx > "$output/source-dependencies.cdx.json"
npm audit --omit=dev --audit-level=high --json > "$output/source-audit.json" || status=1
for role in frontend backend agent installer engine export; do
  image="$prefix-$role:$revision"
  actual=$(docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.Os}} {{.Architecture}}' "$image")
  read -r imageId actualRevision os actualArchitecture <<< "$actual"
  [[ "$imageId" =~ ^sha256:[a-f0-9]{64}$ ]]
  [[ "$actualRevision/$os/$actualArchitecture" == "$revision/linux/$architecture" ]]
  docker image inspect "$imageId" > "$output/$role.identity.json"
  "$scanner" image --image-src docker --parallel 1 --timeout 5m \
    --max-image-size 500MB --scanners vuln,license --list-all-pkgs \
    --format json --output "$output/$role.scan.json" "$imageId"
  "$scanner" convert --format cyclonedx --output "$output/$role.cdx.json" "$output/$role.scan.json"
  "$scanner" convert --scanners vuln --severity HIGH,CRITICAL --exit-code 1 \
    --format table --output "$output/$role.gate.txt" "$output/$role.scan.json" || status=1
done
exit "$status"
