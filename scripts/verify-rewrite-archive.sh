#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]]
exec bash "$(dirname "$0")/with-private-docker.sh" archive "$1" "$2"
