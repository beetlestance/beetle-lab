# Scoped run result presentation

Public entry exports RunResultPanel and root-owned RunResultProps. Existing validated
Run and EngineResult DTOs remain authoritative for their own fields; no fetch/client
or result/metrics interpreter lives here. The pure view fences expected scope/run,
active attempt/engine/generation before reading evidence counts or artifact metadata.
Every render derives current visibility; no previous value survives a scope switch.

Application outcome stays separate from engine-reported evidence. Nonterminal engine
evidence is provisional until application finalization; cancellation/error is never
upgraded to pass. Missing data stays unavailable. Arbitrary summaries are not read.
At most128 artifact declarations and256 thresholds render, with escaped long-token
wrapping and semantic labels. Declarations grant no publication/download authority.

Project light/dark tokens and existing run-detail styling own the visual system.
No new assets, palette, animation or guessed links/actions. RunDetail passes active
requested scope/runId and unavailable/null result until a real read contract exists.
Existing query/cancellation/session ownership is unchanged. Focused checks: this
feature's results.test.tsx, runs/detail.test.tsx, changed lint and web TypeScript.
Synthetic DTO component tests are not browser/native/publication qualification.
