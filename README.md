# beetle-lab

A testing workbench by Beetlestance. Currently supports configurable HTTP performance tests powered by k6, live metrics, saved reports, and run comparisons.

## Run with Docker

```sh
docker run --rm -p 127.0.0.1:4567:4567 \
  -v beetle-lab-data:/app/configs \
  ghcr.io/beetlestance/beetle-lab:latest
```

Open http://localhost:4567. Test configurations and results persist in the named volume. The app is intended for a trusted local environment and does not include authentication.

For local targets from Docker Desktop, use `http://host.docker.internal:PORT` in your config. Inside a container, `localhost` refers to that container.

## Local development

Install Node.js 22 or later and k6, then:

```sh
npm ci
npm run dev
```

Create a bucket in the UI and upload a JSON configuration:

```json
{
  "target": "http://localhost:8080",
  "executor": "shared-iterations",
  "vus": 1,
  "iterations": 10,
  "maxDuration": "30s",
  "thresholds": { "checks": ["rate==1"] },
  "endpoints": [
    { "name": "health", "path": "/health", "checks": { "status": 200 } }
  ]
}
```

See the built-in **Docs** and **Integrations** pages for scenarios, data sources, assertions, runtime sampling, and the HTTP/WebSocket API.

```sh
npm run check
npm test
```

The API tests run in a temporary directory and do not modify your configs or send load to external services.

## CI and container images

GitHub Actions checks JavaScript syntax, runs API integration tests, builds the Docker image, and executes a small k6 smoke test against the container itself. Pull requests validate without publishing.

Successful pushes publish Linux amd64 and arm64 images to `ghcr.io/beetlestance/beetle-lab`:

- `main`: `latest`, `main`, and a commit SHA tag.
- `develop`: `develop` and a commit SHA tag.
- Version tags such as `v1.1.0`: `1.1.0`, `1.1`, and a commit SHA tag.

Publishing uses the repository's built-in `GITHUB_TOKEN`; no Docker Hub credentials are needed. GHCR package visibility must be Public for anonymous pulls.

## Repository policy

`develop` is the default branch. Open feature PRs against it; promote changes to `main` through a PR. Both branches require `ci/checks` and `ci/container`, resolved review threads, and prohibit force pushes and deletion. No approval count is required, allowing a single maintainer to merge after checks pass. Develop uses squash merges; main uses rebase merges.

Policy is declared in `sentinel.yml` and `rulesets/`. Preview with:

```sh
git-sentinel diff --config sentinel.yml
git-sentinel enforce --dry-run --config sentinel.yml
```

Git-sentinel 3.0.2 regenerates repository files during enforcement. Review its plan and preserve the custom README, LICENSE, and `.gitignore` through template injection before applying it. The `configs/` exclusions must remain in place.

## Scope

Browser E2E, test generation, mutation testing, a dedicated CI CLI, and TypeScript migration are future work; the current execution engine is k6.

## License

[MIT](LICENSE). Bundled runtime dependencies retain their own licenses.
