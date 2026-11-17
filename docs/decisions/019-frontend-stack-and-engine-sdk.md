# Decision 019: frontend stack and engine SDK packaging

Status: accepted under the user's delegation of routine library choices. Recorded
on 17 November 2026 from the former frontend decisions page; the choices date from
the start of the rewrite.

## Decision

- The browser application is React with Vite, React Router for navigation and
  TanStack Query as the single owner of server state. Router loaders do not
  duplicate Query loading; form drafts stay local; no Redux or custom state
  framework without a concrete cross-feature need.
- Simple transitions use CSS. A motion library is considered only for interaction
  CSS cannot express clearly. Reduced motion and focus behaviour are acceptance
  criteria, not polish.
- Small feature components and a few owned accessible primitives; no design-system
  package inside the repository. Charts take pre-aggregated bounded samples with
  explicit units, scope and missing-data states; Chart.js stays while it passes.
- Separate images: static frontend served by Nginx that proxies `/api/` and SSE to
  the backend; backend; agent; disposable engine. Only the frontend publishes a
  loopback port. All images share one release and protocol manifest.
- An engine plugin is an installed manifest, engine image, versioned schemas and
  protocol conformance, not a module loaded into the backend. The first engine
  ships schemas, fixtures, a TypeScript reference wrapper and a container
  template. A public SDK waits until a second engine shows which helpers are
  genuinely shared; non-Node engines implement the protocol directly.

## Why

The UI needs scoped navigation, editable suites and settings, live run events,
bounded charts, downloads and comparisons. It needs no SEO, server rendering or a
second business-logic backend, so a static single-page application fits.
Engine authors may use any language; the application never carries their runtime.

## Alternatives

| Option | Outcome |
| --- | --- |
| Vue + Vite | Viable; different conventions with no architectural advantage |
| Svelte | Viable; familiarity and data, table and editor integrations unproven |
| Existing vanilla modules | Rejected: routing, caching and composition would be rebuilt by hand |
| Publish an npm SDK with the first engine | Rejected: one consumer cannot show which helpers generalise |

## Consequences

Browser rules are in the [web UI contract](../system/contracts/web-ui.md) and the
image boundaries in the [installation contract](../system/contracts/installation.md).
Bundling shared design assets waits on their distribution terms (the asset
release declares GPL-3.0-only; Beetle Lab is MIT, [decision 002](002-mit-license.md));
that item is tracked in the [backlog](../plans/backlog.md).

## Review triggers

Revisit if server rendering or SEO becomes a requirement, if Query ownership
cannot express live events cleanly, or when a second engine exists.
