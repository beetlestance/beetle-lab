#!/usr/bin/env bash
set -euo pipefail
image="${1:?image tag required}"
container=$(docker run -d -p 127.0.0.1::4567 "$image")
trap 'docker logs "$container"; docker rm -fv "$container" >/dev/null' EXIT
port=$(docker port "$container" 4567/tcp | awk -F: '{print $NF}')
ready=false
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$port/api/folders" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ]
curl --fail --silent "http://127.0.0.1:$port/integrations/beetle-lab.skill.md" | grep -q '^# beetle-lab'
docker exec -i "$container" sh -c 'cat > /tmp/smoke.json' <<'JSON'
{"target":"http://127.0.0.1:4567","executor":"shared-iterations","vus":1,"iterations":2,"maxDuration":"10s","thresholds":{"checks":["rate==1"],"http_req_failed":["rate==0"]},"endpoints":[{"name":"folders","path":"/api/folders","checks":{"status":200}}],"memorySampling":{"enabled":false}}
JSON
docker exec -e CONFIG=/tmp/smoke.json "$container" k6 run --quiet /app/loadtest.js
