# Observed k6 load guidance

Status: F10 consumer slice. Native warning classification remains separate.
Owner: frontend load-advice, using existing verified live/history read owners.

## Source interpretation

Only render for a k6 Run. Consume the current ready live frame or current ready
recorded catalogue page; no new query, cache, window accumulator or source reader.
Look for one execute-scoped global dropped_iterations counter with count units and
empty tags. Missing, ambiguous, malformed or differently scoped series are unknown.
A declared metric alone never proves zero. A present valid zero is recorded zero,
not proof that missing source windows had no drops.

Live upstream coverage is unknown by contract. Label its count as observed in the
displayed source window, never an accumulated whole-run total. Historical totals
refer to the published metric source; incomplete coverage gives observed counts
only. A metric absent from a catalogue page is not necessarily absent from the Run.
Parent scope/attempt/source and freshness owners retire the entire advice surface.

Do not diagnose a small VU pool solely from dropped work. Arrival-rate executors
can lack free VUs; iteration-count executors can exhaust maxDuration. Slower target
responses and generator pressure also require investigation. Preserve existing
suppression of URL-bearing native warning logs; no raw logs are newly exposed.
See [k6 dropped iterations](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/).

## Explicit planning calculator

For recorded complete coverage only, use one actual execute/global
iteration_duration trend in milliseconds, with its estimated median, bounds and
sample count. Do not substitute HTTP latency or readiness/request-tagged series.
Missing, zero, invalid or partial statistics yield no numeric recommendation.

The user supplies desired iterations/second (not HTTP RPS) and headroom percent.
The displayed candidate is ceil(medianMs/1000 * rate * (1 + headroom/100)).
This is an explicit planning heuristic; headroom defaults to 20% and is editable,
not a k6 guarantee or measured safe capacity. Show sample count/median bounds.
Use a small trial and check CPU/RAM and target slowdown before editing a suite.
It neither infers the configured scenario rate nor changes configuration/budgets.
The [allocation guide](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/arrival-rate-vu-allocation/)
relates VU allocation to iteration duration/rate and variance; the UI margin is an
application choice, not that documentation's mandatory recommendation.

Inputs are at most 16 characters: finite decimal/exponent rate >0..1,000,000 and
headroom 0..500%. Reject overflow/unsafe integer output without clamping. Live
series <=20 and catalogue <=100 remain the existing admission boundaries. Do not
retain statistics from another page or invent values when the source disappears.

## Acceptance

Cover positive/zero/missing/ambiguous/invalid/scope/unit distinctions, current-window
versus recorded/partial wording; median versus HTTP duration, units, sample/bounds,
zero/partial/missing/overflow and input limits; page/scope/freshness retirement and
no extra requests/mutations. Run focused consumer/lifecycle tests, frontend types,
lint/docs/architecture and one source build. No new producer, compiler, native
warning parser, engine image or release-qualified recommendation is claimed.
