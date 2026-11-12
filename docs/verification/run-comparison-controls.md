# Comparison browser controls evidence

Status: locally verified components; actual browser qualification pending.
Scope: F13 comparison route, history selection and bounded metric charts.
Source: the feature commit containing this report, based on da670ea.
No backend, schema, dependency, engine or storage interface changes.

## Behavior

Workspace history selects two through four terminal runs in selection order.
The first run becomes baseline. A bounded UUID-only URL retains that selection;
malformed/duplicate/foreign query fields fail before API reads. Scope/session
replacement clears selection and immediately hides retired comparison evidence.
The generated comparison client validates all snapshots. Application outcomes and
engine evidence remain distinct. Config differences expose paths and their limit;
environment fingerprints retain unknown-condition warnings rather than claiming
that runs are comparable. No config values or secret resolution is introduced.

One baseline metric page chooses a logical metric key, with replacement paging.
Backend-returned per-run aliases/ordinals, source manifests and markers remain
explicit. Four independent historical charts reuse existing projection, sampling,
estimate bounds and UTC source intervals; no false alignment or percentile math.
Missing measurements do not become zero. Sample replies must match both the
selected metric identity and source manifest before reaching the existing chart.

## Checks and scope

Focused component tests exercise selection cardinality/order and terminal state,
invalid routes, catalogue paging, explicit missing peers, two/four chart execution,
manual failure recovery and one shared exposed API-original admission. Lifecycle
cases hold typed API promises across URL/session changes and actual unmount/remount;
retired success cannot display values or release admission before that promise
settles. StrictMode issues no duplicate successful load. Wrong logical series at
the correct ordinal cannot draw a chart. Existing history/range/metric composition
cases cover the changed sampling boundary. Web types, changed lint, architecture
and authored-document checks are required before integration.

An initial fixture read used a Node import incompatible with frontend typing;
it now uses the existing static JSON fixture convention. An invalid synthetic
cursor was corrected to the registered cursor encoder. The remount test exposed
per-component admission and led to the retained module-lifetime owner. Complexity
gates required a separate source guard and source evidence presenter; no gate
was weakened. The stricter source guard also caught an old range fixture returning
a different metric at ordinal1; its successful-selection reply now matches the
selected descriptor. Failed runs remain in private task evidence.

## Limits

API-original admission is not proof of ignored underlying fetch settlement:
the shared generated transport can return early on abort/deadline. Component
regressions deliberately distinguish typed API originals from fetch promises.
There is no result cache or background polling in this surface. At most four
replacement charts retain1,000 points/1MiB each; every action reads at most ten
pages. The comparison service remains the authoritative source/data guard.

The required browser-control runtime is unavailable in this session. These checks
do not establish actual browser navigation, visual layout, keyboard accessibility,
file saving, new native k6 execution, packaging or release qualification. The
separate UI redesign remains deferred until functional completion.
