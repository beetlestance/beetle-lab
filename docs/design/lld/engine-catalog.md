# Installed engine catalogue and preflight

Status: implemented and independently reviewed component; actual installation
startup/runtime qualification remains.
Scope: trusted local installation, not a schema-upload API or engine marketplace.

An installation registers at most32 pinned engine/profile/config-version combinations.
Registration supplies a manifest, approved Docker profile, positive config version,
validation identity and opaque ConfigSchema created by the shared contract adapter.
Arbitrary validator callbacks and remote schema resolution are unsupported. All
registrations use the same installation, staging root and UID policy.

ConfigSchema snapshots at most16 trusted schemas/256KiB, selects a root present in
that bundle and compiles strict synchronous JSON Schema2020-12 validation. It does
not coerce, insert defaults or remove unknown fields. Configuration input is bounded
to1MiB and copied before validation; accessors/non-JSON values reject. The descriptor
is immutable and runtime-branded. Its digest covers UTF-8 of:

```text
beetle-lab.config-schema.v1\n<root schema ID>\n<encodeJson(bundle in installed order)>
```

The digest provider is trusted installation SHA256. This is content identity, not
authentication. The shipped k6 adapter imports the same language-neutral schema
files used by engine generation, without importing compiler or runtime code.

Catalogue construction snapshots registration JSON and checks manifest/schema/profile
bindings, schema digest, one installation identity and unambiguous offer selection.
It derives admission ApprovedProfile entries from those pins and manifest minima;
staging allowance remains owned by admission. Unknown engine/image/config versions
and unsupported capabilities reject before queueing. An offer cannot choose a path,
entrypoint, Docker flag, schema bundle or validator.

`preflight` returns one immutable Offer bounded to2MiB, its exact installed engine and
ValidationIdentity including configDigest. It validates the runner envelope,
engine-specific structure, approved runtime feasibility and capabilities. It reads
no datasets, resolves no secrets and performs no I/O or semantic compilation.
Success means pending admitted engine validation, as specified in
[the validation decision](../../decisions/007-admitted-validation.md).

For this feasibility probe only, a temporary Offer copy raises the five budget
fields below trusted manifest minima to those minima. After original envelope,
installed identity and engine config validation, it projects config to an empty
object and inputs/secret references to empty arrays: those payload bytes do not
affect native guards and cannot make the probe exceed the original Offer byte cap.
Larger budgets and every native guard field stay exact, so profile maxima and
unsupported controls still reject. Future native guards using an omitted payload
field must amend this private projection.
The copy never becomes the returned/persisted Offer or an execution plan.
Admission owns the original minimum-budget policy decision and durable refusal.

`resolve` is recovery-only: the complete persisted validation identity and immutable
engine/config bytes must match the installed entry. It never selects a newer
catalogue version implicitly. Missing old pins keep uncertain executions charged and
visible for reconciliation rather than rerunning load with another image.

The catalogue and admission share MAX_ENGINE_PROFILES=32. Public prepareRuntime
validates actual offered budgets/profile flags, including manifest minima and
profile maxima. Registration and actual staging/recovery use those strict guards
with their original budgets; public journal configDigest owns
configuration identity. Registration rejects ambiguous engine/image/config-version
selection and freezes its own JSON snapshots rather than retaining caller objects.
