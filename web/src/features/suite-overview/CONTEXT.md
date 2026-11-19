# Suite overview context
Overview, LoadShape and StartRun render an already-loaded saved revision. `plan.ts`,
`details.ts` and `changes.ts` are bounded literal projections of the k6 config: no
compiler, secrets or request bodies. Executor labels share lib/k6-executors.ts. The target shows its origin only, and input names
come from at most 16 cached getInput reads.
RecentRuns makes one indexed suite-filtered listRuns read (limit 5). Errors stay unknown
and nothing polls. StartRun reads workspace settings and submits createRun through
execution-request and runs/useSubmission. A budget field changes only for this run, and
untouched fields keep their exact API values. The optional note is captured in the
same createRun body, persisted atomically and frozen during unknown-outcome replay;
there is no second note mutation. start-run.css owns the 620 px dialog/phone sheet.
Length, budget and target share one facts list; settings supply real limits.
Suite controls preserve read-only access: no run, metadata or revision mutations.
Tests: plan.test.ts (projection, budget, time copy) and ui.test.tsx (recent runs, scope).
