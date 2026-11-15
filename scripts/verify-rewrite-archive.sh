#!/usr/bin/env bash
# Linux CI only: never connect this proof to the source daemon or a user store.
set -euo pipefail
[[ $# == 2 && $1 == /* && $2 == /* && ! -e $2 && ! -L $2 ]]
[[ $(uname -s) == Linux ]]
archive_bundle=$1
archive_output=$2
archive_dockerd=$(command -v dockerd)
[[ $archive_dockerd == /* ]]
archive_root=$(mktemp -d "${RUNNER_TEMP:?}/beetle-archive-store.XXXXXXXX")
archive_root=$(realpath "$archive_root")
archive_unit="beetle-archive-$(basename "$archive_root")"
archive_started=false
finish_archive_proof() {
  local result=$?
  trap - EXIT INT TERM
  if $archive_started; then
    local state=unavailable
    state=$(sudo -n systemctl show "$archive_unit" --property=LoadState --value) || result=1
    if [[ $state != not-found ]]; then
      sudo -n systemctl stop "$archive_unit" || result=1
    fi
    if sudo -n systemctl is-active --quiet "$archive_unit"; then
      result=1
    else
      local inactive=$?
      if [[ $inactive == 3 || $inactive == 4 ]]; then
        # Remove only this exclusive store after the whole service group stopped.
        sudo -n rm -rf -- "$archive_root/store" "$archive_root/exec" || result=1
      else
        result=1
      fi
    fi
  fi
  exit "$result"
}
trap finish_archive_proof EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' '{"features":{"containerd-snapshotter":false}}' >"$archive_root/daemon.json"
archive_started=true
sudo -n systemd-run --unit="$archive_unit" --service-type=exec --collect \
  --property=MemoryMax=1536M --property=CPUQuota=100% --property=TasksMax=128 \
  --property=RuntimeMaxSec=600 --property=TimeoutStopSec=15 \
  -- "$archive_dockerd" --config-file="$archive_root/daemon.json" \
  --data-root="$archive_root/store" --exec-root="$archive_root/exec" \
  --pidfile="$archive_root/daemon.pid" --host="unix://$archive_root/docker.sock" \
  --group="$(id -gn)" --storage-driver=vfs --bridge=none \
  --iptables=false --ip6tables=false --ip-forward=false --ip-masq=false \
  --userland-proxy=false >"$archive_root/start.log" 2>&1
archive_ready=false
for ((attempt=0;attempt<60;attempt++)); do
  if timeout 1s docker --host="unix://$archive_root/docker.sock" info >/dev/null 2>&1; then archive_ready=true; break; fi
  sleep 0.5
done
$archive_ready
node --import tsx tools/delivery/roundtrip.ts "$archive_bundle" "$archive_output" \
  "unix://$archive_root/docker.sock" "$archive_root/store"
