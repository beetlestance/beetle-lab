# Decision 031: Installed settings outlive shipped defaults

Status: accepted. Recorded on 19 November 2026.

## Decision

An existing Compose installation keeps the settings (`installationValues`) and
admission policy (`agentPolicy`) it was provisioned with. Before the bootstrap
gate opens, setup and the capacity command rebuild the request from this
release's bindings and engine template plus those two values read from the
baseline configuration (`config/installation.json`, `config/agent.json`). The
values are selected against the baseline receipt's configuration digests and
decoded by their owning decoders, then the rebuilt request must still match the
gate's and the receipt's request digest exactly. A fresh installation, or one
whose first setup never reached `ready`, uses this release's starter request.

Bindings the baseline configuration records are compared first: root, agent
container, target network, Docker socket and agent origin. Any difference
refuses with `binding_changed` and the fixed names of the bindings that differ;
nothing is re-pinned. Every other difference, including the engine template,
image references and the external origin, still fails the digest check and is
`recovery_required`.

## Why

The request digest pinned the whole starter request, defaults included. Raising
the agent's control reserve from 1350 to 2100 millicores in commit 03a32ee9
therefore made every existing installation refuse `up`, `setup upgrade` and
capacity changes with `recovery_required`, with no path forward. Starter values
are documented as editable defaults: they describe a first installation, not a
running one, whose operator may already have changed them.

Starting a beetle-local installation under the new default instance name failed
the same way, without saying why. A named refusal tells the operator which
setting to put back.

## Alternatives

- Exclude defaults from the digest: rejected. Every existing receipt and gate
  stores the digest of the full request, so changing its definition would itself
  strand every installation.
- Apply new defaults to existing installations through `setup upgrade`:
  rejected for now. It would rewrite settings an operator may own, and capacity
  changes already have their own audited path.
- Re-pin changed bindings (an instance rename) in `setup upgrade`: deferred. It
  rewrites the baseline receipt, the gate and the agent's container identity,
  which the baseline-is-immutable rule in the installation contract forbids.

## Consequences

Starter policy changes reach new installations only; the contract table names
the value earlier installations keep. Engine template changes (a new engine
version or manifest) still need an upgrade path of their own before a release can
ship them. The local launcher compares its own setup files and is unaffected.

## Review triggers

Revisit when instance renames or engine template upgrades are needed, or if
operators need a way to adopt new defaults on an existing installation.
