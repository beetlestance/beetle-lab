# beetle-lab

A self-hosted testing workbench by Beetlestance, with configurable k6 performance
tests, isolated execution, live metrics, durable results, comparison and reports.

## Run with Docker Compose

Docker Compose builds and starts separate frontend, backend, agent and engine
images. Linux containers on amd64 and arm64 are supported.

```sh
docker compose up --build -d
```

Open http://127.0.0.1:4567. Browser access is automatic. Private installation
state, tests and results persist under `.beetle/`; keep that directory between
starts. Stop the installation with `docker compose down`. `npm start` runs the
same Compose startup command. The advanced recipe is `compose.rewrite.yml`.

`BEETLE_HOME` can select another absolute canonical directory before the first
start. Existing installations preserve image pins, identity and data. Changing
installed static capacity is a separate lifecycle operation; editable run settings
cannot exceed the installed engine policy. Docker socket access is a trusted
installation execution boundary. Setup and the agent are trusted with Docker host
control: a read-only socket mount still permits Docker API mutations and is not
a host security sandbox. Setup starts as root to prepare an empty installation;
the agent bootstrap drops to UID/GID 1000 with no retained Linux capabilities.
A compromised agent can still control the Docker host through its socket. Use an
installation only with administrators and code you trust. No constrained Docker
broker or rootless-daemon guarantee is shipped. The UI port is loopback-only;
backend and agent ports are private.
For targets running on the Docker Desktop host, use `http://host.docker.internal:PORT`.

## Run on a VPS

Run the same Compose command on the server. From your computer, forward the UI:

```sh
ssh -N -L 4567:127.0.0.1:4567 user@your-vps
```

Open http://127.0.0.1:4567 in your browser. The installation and engines run on the
VPS; only the browser runs on your computer. No application IAM is needed for
this single-administrator installation.

Current browser-origin validation requires a loopback URL. Direct access through
a server IP/domain or public reverse proxy needs additional origin/access support.

## Images and releases

The previous single-container application has been retired from source and CI.
Previously published `ghcr.io/beetlestance/beetle-lab:latest` images contain that
application; this change does not replace or revoke existing registry artifacts.
Use source Compose above. Do not use the old single-container installation recipe.

Rewrite delivery builds six matching component images for both architectures,
with native execution, vulnerability scans, SBOM/license reports and archive
round-trip checks. Publication uses the explicit qualified-delivery workflow;
ordinary pushes no longer publish the retired image. Immutable rewrite candidate
releases remain separate from promoting a new public default.

## Development and verification

Use Node.js 24.12 or later for source development:

```sh
npm ci
npm run check
npm test
```

`npm run dev` starts Compose in the foreground; `npm run dev:web` runs the Vite
frontend developer server. Native image checks run in GitHub CI. Test fixtures
use synthetic data and do not require an external production service.

See the [documentation map](docs/README.md), [current status](docs/STATUS.md)
and [acceptance ledger](docs/verification/final-acceptance.md). Release publication
and the UI redesign remain separate work. The app's API reference includes downloadable AI-agent instructions; an MCP server is not shipped.
A full UI redesign, additional engines, test generation and multi-user IAM are later work.

## License and attribution

[MIT](LICENSE). Bundled dependencies retain their own licenses. README attribution
is appreciated for forks: Based on beetle-lab by Beetlestance.

### Component health and storage failure

Backend and agent expose `GET /healthz` and `HEAD /healthz` on their private control
listeners. They return 200 only while their storage owner is ready, otherwise 503.
These fixed responses contain no user data and require no credentials; other
private agent routes still require authentication. Probes never enqueue SQL.

A fatal storage worker failure fences commands, reports bounded diagnostic codes,
and starts process shutdown. The process exits with status 1 after cleanup or at
its 10-second deadline. Forced exit does not certify completed cleanup: normal
journal recovery must resolve uncertain work after restart, without retrying writes.
Compose already uses `restart: unless-stopped`; its probes now expose component
health and frontend startup waits for backend health. Docker does not restart a
container merely because a health probe fails.

Image probes use the same listener configuration as startup, including nondefault
ports and IPv6 loopback. Wildcard IPv4 is probed through IPv4 loopback. The agent
probe drops bootstrap root privileges before connecting, just as its entrypoint does.
