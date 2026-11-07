# Frontend, assets and engine SDK discussion

Status: frontend choice delegated and selected; asset terms/SDK scope still open. Docker-only delivery and separate images are
confirmed. Keep these choices independent of engine implementation language.

## Frontend framework

The UI needs org/workspace navigation, editable suites/settings, live run events,
chart ranges, artifact downloads and comparisons. It does not need SEO, server
rendering, React Server Components or a second business-logic backend.
The user requires animations, motion and responsive interaction. Use CSS for
simple transitions; evaluate a small motion library only for interaction needs
CSS cannot keep clear. Honor reduced motion, focus behavior and chart budgets.

| Choice | Fit | Cost to account for |
| --- | --- | --- |
| React + Vite | Explicit components; router/query tooling; straightforward typed API integration | Needs disciplined state/query ownership and deliberate rendering limits |
| Vue + Vite | Template-oriented components with TypeScript; viable for the same product | Different component/state conventions; no architectural advantage assumed |
| Svelte | Compiler-led component approach; viable static application | Team familiarity and chosen data/table/editor integrations need evaluation |
| Existing vanilla modules | Few initial dependencies | We would have to rebuild structured routing, query/cache and composition conventions |

Selected under the user's delegation: React + Vite, React Router for navigation,
TanStack Query for
server-state ownership. Use Router declarative navigation; do not duplicate
server loading in both router loaders and Query. Keep form drafts local and feed
SSE updates into one query/cache owner. Do not add Redux or a custom state framework
without a concrete cross-feature need.

Qualify the selected stack with one representative fixture: organisation switch -> queued/live run
-> bounded chart -> settings validation -> result comparison, including keyboard
and mobile behavior. Evaluate dependency footprint, interaction code size and
maintainability; no framework performance claim without the fixture.

## Component and chart policy

Use small feature components and a few owned accessible primitives. Do not build a
full design-system package inside this repo. Decide between a small headless
primitive library and owned simple controls based on dialogs, menus and tree/editor
needs. Charts must accept pre-aggregated bounded samples and retain explicit units,
scope and missing-data states. Reuse Chart.js initially if it meets those tests;
there is no need to replace every existing library during the rewrite.

## Frontend/backend images

Frontend: compiled static assets plus Nginx configuration. Backend: Fastify API and
metadata/artifact ownership. Agent: private execution control. Engine: disposable
runtime. Publish only frontend on loopback; proxy `/api/` and SSE to the backend
with bounded buffers, explicit upstream timeouts and no SSE response buffering.

Same-origin cookies/CSRF still work through the proxy. Backend trusts forwarded
headers only from the configured proxy/network; never arbitrary client-provided
Host/proto values. Backend/agent have no public host ports by default. CI can start
backend+agent without frontend. All images share a compatible release/protocol
manifest; container separation must not create accidental version mismatches.

## Shared assets and license

The inspected shared asset release metadata declares GPL-3.0-only; beetle-lab is
MIT. That is a distribution decision to settle before copying/bundling files.
Do not rewrite an asset's license metadata or assume ownership of every contribution.

Options to discuss: explicit compatible distribution terms/permission from the
rights holders; a consciously reviewed licensing change; or independently authored
UI styling without copied asset implementation. This plan does not choose a legal
interpretation or grant rights on the user's behalf.

After terms are settled, bundle a verified exact asset release locally with its
manifest/license/provenance. A locally run product should not require an external
asset host for fonts, scripts, themes or icons. Avoid mutable CDN/latest URLs.
Framework components own focus and DOM lifecycle; shared DOM helpers must not
mutate the same elements or install duplicate event handlers.

## Engine SDK packaging

A plugin is an installed manifest + engine image + versioned schemas and protocol
conformance, not a TypeScript module loaded into Fastify. Engine authors may use
any language. The application never needs their language runtime in its image.

For the first engine, ship schemas, valid/invalid fixtures, a small TypeScript
reference wrapper and a container template. Keep protocol framing/journaling,
cancellation and artifact helpers reusable; keep k6 compilation/result semantics
inside its adapter. A second engine should prove which helpers genuinely belong
in a reusable SDK before publishing one as a public npm package.

Do not require Node inside a Rust/Python engine just to satisfy the SDK. Such
engines may implement the documented protocol directly and run the same conformance
suite. Add language SDKs only when an actual consumer needs them. Version protocol
and engine independently; pin installed images by digest and update explicitly.

## Open implementation/distribution decisions

1. Qualify accessible primitives/chart/editor libraries against the first screen;
   routine library selection is delegated, not another framework preference poll.
2. Beetle-lab MIT licensing is [settled](../decisions/002-mit-license.md). Settle
   asset/media/brand distribution separately; AI-generated media does not change
   the existing CSS/JS declaration. This plan does not relicense the asset repository.
3. Confirm whether a reference engine template is enough initially or an immediate
   external engine author requires a published SDK package.

Sources: [React](https://react.dev/learn/build-a-react-app-from-scratch),
[Vue](https://vuejs.org/guide/introduction.html),
[Svelte](https://svelte.dev/docs/svelte/overview),
[TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview).
