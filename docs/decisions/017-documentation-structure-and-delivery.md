# Decision 017: documentation structure and delivery

Status: proposed, 17 November 2026. Awaiting user approval.

## Decision

Organise `docs/` by the question each folder answers, with one owner per fact:

| Folder | Answers | Changes when |
| --- | --- | --- |
| `system/` | What is built now | The code changes, in the same commit |
| `plans/` | What will be built | The plan changes; deleted when it ships |
| `decisions/` | Why a choice was made | Never; superseded by a new record |
| `evidence/` | What was measured, at which commit | Never; new evidence is a new file |
| `guides/` | How to install, operate and automate | User-facing behaviour changes |
| `engineering/` | How to work on the code | The process changes |

Nothing stays loose at the top of `docs/` except its README map.

Keep `system/contracts/` to roughly ten to fifteen cross-service contracts that
types cannot express: execution protocol, run lifecycle, outputs, retirement,
recovery, resources, installation, storage, results, exports, inputs, engines and
the public API surface. Module internals belong in the module's `CONTEXT.md`.
Request and response shapes belong in the generated contracts that CI checks.
Reasoning moves into decision records. Status lines leave contracts entirely.

A `system/` page names the code it describes and records a reviewed hash per
anchor. A changed anchor fails the documentation check until someone rereads the
page and stamps it again. Stamping is a reviewer's statement, never automatic.

Later, user-facing documentation is written separately from `system/`, rendered
by an off-the-shelf static generator, served inside the frontend image at `/docs`
and published as a public site from the same build.

## Why

Current documents mix tense. `STATUS.md` combines available behaviour with open
gaps, `PLAN.md` combines phases with current state, and 124 of 127 LLDs open with
a status line that duplicates STATUS and goes stale. LLD updates landed in
documentation-only commits rather than with the code they describe.

One-owner folders make a plan impossible to mistake for current behaviour, and
let checks enforce tense: `system/` may not say "pending", `plans/` must carry a
status, `evidence/` must name a commit.

In-app documentation matches the installed release and works offline; a public
site serves people evaluating Beetle Lab. A generator supplies navigation, search
and code highlighting, so effort goes into diagrams, examples and interactive
pieces rather than a hand-built viewer.

## Alternatives

- Keep 127 LLDs: rejected for drift and duplicated status.
- Convert every LLD into a decision record: rejected. Contracts must change with
  the code; frozen records would need supersession chains to describe today.
- Render internal docs directly as the public site: rejected. They are written
  for maintainers and agents, not for people learning the product.
- A hand-built in-app viewer: rejected. It spends effort on navigation and search
  that generators already provide.

## Consequences

AGENTS.md, engineering.md and every link into `docs/design` change in one move.
`check-docs` gains folder rules and anchor stamps. Moved files keep their history
through `git mv`. The generator and diagram tooling need their own approval.

## Review triggers

Revisit if contracts grow past twenty files, if stamps are routinely re-stamped
without rereading, or if a second product needs versioned documentation.
