#!/usr/bin/env bash
# Task-local official binary, pinned version and independently retained checksums.
set -euo pipefail
destination=${1:?new destination required}
[[ ! -e "$destination" ]]
case $(uname -m) in
  x86_64) platform=64bit; checksum=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf ;;
  aarch64|arm64) platform=ARM64; checksum=ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3 ;;
  *) exit 2 ;;
esac
[[ $(uname -s) == Linux ]]
mkdir -m 700 -p "$destination"
archive="$destination/trivy.tar.gz"
curl --fail --silent --show-error --location --max-time 120 \
  "https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-$platform.tar.gz" --output "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check
tar -xzf "$archive" -C "$destination" trivy
"$destination/trivy" --version
