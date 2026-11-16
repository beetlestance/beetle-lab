#!/usr/bin/env bash
# Pinned task-owned registry client; no system installation or mutable download.
set -euo pipefail
[[ $# == 1 && $1 == /* && ! -e $1 && ! -L $1 ]]
case "$(uname -s)/$(uname -m)" in
  Linux/x86_64) registry_arch=amd64; registry_sha=3737fbbdd791e04e7a831640b681f3397a376498e80e2ad9b1b2d27296f239bc ;;
  Linux/aarch64|Linux/arm64) registry_arch=arm64; registry_sha=9f349bab5c407ac04f3dabf99c7c7a6b0f9e9723c23f2775380e804d02c6dbb9 ;;
  *) exit 1 ;;
esac
mkdir -m 0700 -- "$1"
curl --disable --silent --show-error --fail --location --proto '=https' --proto-redir '=https' \
  --max-time 120 --max-filesize 33554432 \
  --output "$1/regctl" "https://github.com/regclient/regclient/releases/download/v0.11.7/regctl-linux-$registry_arch"
printf '%s  %s\n' "$registry_sha" "$1/regctl" | sha256sum --check --status
chmod 0700 "$1/regctl"
