# Organisations, workspaces, folders and settings

Status: organisation grouping is requested; detailed defaults are proposed here.
This document owns hierarchy/scoping and settings resolution, not user roles.

## Hierarchy

```text
Installation
  Organisation                 # Company/client view
    Workspace                  # Service/project or related test collection
      Folder (optional, nested)
        Suites and input files
      Suites/inputs at workspace root are also valid
```

Organisation is useful when one installation serves several companies/clients.
Workspace remains useful for separate projects inside one organisation. If a user
needs only one project per company, one workspace per organisation is sufficient;
folders are optional and do not add another mandatory setup step.

Folders group suites and inputs; they do not create execution agents or grant
permissions. Runs belong to the suite's immutable organisation/workspace identity;
moving a suite within its workspace does not rewrite historical run identity.
No organisation accounts, invitation, SSO or membership roles in the local release.
The user confirmed one local administrator may manage every organisation.
Do not create duplicate admin/root/member accounts for this single identity.
Future hosting needs a new IAM/role-policy design. Shared/multi-user
access control is a later feature, not implied by filtered views.

## Scoping invariants

- Every owned suite/revision/input/run/attempt/result/artifact has an unambiguous
  organisation and workspace scope. Store scope directly where hot queries need
  it; enforce parent/child consistency with composite keys/foreign keys.
- Resolve organisation from the authenticated request route, never ambient mutable
  global state. Repository methods require scope; an object UUID alone is insufficient.
- Wrong-org IDs return scoped not-found; no cross-org suite inputs, secret refs,
  artifact downloads, exports, comparisons or cursor reuse.
- Query/cache keys, SSE subscriptions, sample requests, search and command menus
  include organisation ID. On switching, abort old subscriptions and render only
  the new scope. Running tests continue; switching views never cancels them.
- Installation capacity is shared globally. An organisation setting cannot claim
  another copy of the machine's CPU, RAM or disk.

Database schema task must exercise mismatched parents and scope joins, not just
handler filters. The agent receives validated scope and preserves it on every
journal/event/output record; a wrapper cannot relabel its owning organisation.

## Folders

Use folder UUIDs plus parent_id within one workspace, not arbitrary host paths.
Unique sibling names; root is a real workspace-owned root identity so SQL NULL
uniqueness cannot admit duplicate root names. Start with maximum depth 8 and names
128 characters; these are validation defaults to review, not path-length guarantees.

Move checks same workspace, target existence and acyclicity transactionally;
optimistic versions reject conflicting moves. No cross-workspace moves in v2;
explicit copy creates new identities later. Input manifests pin IDs/digests, not
mutable display paths. [Namespace deletion](namespace-deletion.md) initially permits empty scopes only
and refuses retained dependencies. Recursive cleanup requires separately admitted
maintenance and is not exposed by the empty-only DELETE controls.

## Settings ownership

| Scope | User-facing examples | Constraints |
| --- | --- | --- |
| Installation | Engine pool CPU/RAM, disk ceiling, concurrency, supported profiles | Docker capability and effective capacity bound the values |
| Organisation | Default engine profile, retention preference, display defaults | Inherit installation values; cannot exceed its ceilings |
| Workspace | Default target, timeout, run budget, retention override | Must stay inside organisation/installation policy |
| Suite revision / run | Explicit execution overrides | Snapshot effective values before acceptance |
| Browser preference | Theme, selected org, table layout | Local presentation; never backend policy authority |

Resolution for run defaults: installation defaults -> organisation override ->
workspace override -> suite revision -> explicit run override, then enforce the
installation's hard ceilings. Runtime capability checks also apply. A field may
inherit or override; show effective value, source and allowed range in the UI.
Do not store a full copied defaults object at every scope or introduce a generic
expression/rule language. Use versioned typed settings schemas and explicit fields.

Retention resolves installation -> organisation -> workspace. Existing runs keep
recorded execution settings. Changing future defaults cannot alter an active
container or its accepted input identity. Retention settings affect existing
results only after an explicit preview/apply action.

## Safe settings changes

PATCH uses expected version and returns validated effective settings plus new
version. Out-of-range values fail with useful errors; never silently clamp or
raise installation limits. A global ceiling lowered below active reservations
blocks new admissions and takes effect as jobs drain; it does not kill them.
A requested increase beyond runtime-reported capacity is rejected.

Budget/concurrency/isolation settings are visible in the run form with their consequences:
CPU cap throttles, memory cap may stop the test, timeout cancels it, output cap
limits retained evidence. Parallel mode is allowed when requested/configured;
isolated measurement is optional. Show concurrency/idle/thermal settings and record
the effective policy/observation availability in the run snapshot.

## Retention defaults

Match current manual deletion: keep completed results until the user deletes them
or explicitly enables a retention rule. Offer age, completed-run count and storage
budget controls in the organisation/workspace UI. Pinned and active results remain
protected; inputs referenced by retained revisions remain protected.

User-selected installation disk allocation bounds admission, with a configurable
free-space reserve. Setup reports current usage and asks for an allocation; no
fixed 10-GiB product requirement. A full store warns/refuses new runs; it never enables
age deletion. Preview candidates/estimated bytes, exclude active/pinned data,
then require explicit apply for a new rule affecting existing results. The bounded
janitor revalidates each item and stores a recovery cursor. Report partial deletion
and errors; do not claim freed bytes from an unexecuted preview.

## Acceptance

Create two organisations with identically named workspaces/folders/suites. Exercise
all list/read/mutation/report/event paths with wrong-parent IDs. Verify cache/cursor
and comparison isolation, concurrent folder moves, settings inheritance, active-run
snapshots, global resource competition, full disk, retention preview and interrupted
cleanup. These establish local namespace separation; multi-user security needs
its own authorization tests/design before it can be advertised.
