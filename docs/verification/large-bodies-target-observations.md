# Large request bodies and target observations

Status: locally verified native arm64 execution. This is a bounded feature slice,
not complete target charts, report heuristics or release qualification.

## Behavior

Literal JSON/text bodies can use published, immutable input files without the
small dynamic-template limit rejecting their content. Dataset/header/path and
dynamic-template limits are unchanged. Revision input manifests now include body
references and datasets, normalize/deduplicate exact identities, reject conflicting
pins and retain the combined64-input ceiling. Upload/publication and scoped input
validation still precede engine staging.

Native plan generation streams quoted literal-body strings, preserving JSON
escaping/Unicode. Only compiler-marked body fields gain the8MiB expanded-string
allowance; unrelated strings/keys retain65536 characters. Both serialization
passes enforce the existing24MiB/caller byte cap, node/depth/cycle checks and
original file-close ownership. A changed second-pass total rejects explicitly.
See [body contract](../design/lld/request-bodies.md).

Optional target sampling reads fixed numeric fields from one relative HTTP path
under the compiled target. It retains bounded, separately labeled observations;
missing/invalid fields are null. Failures remain advisory only after confirmed
cleanup. Cancellation, failed startup, retention refusal and close drain their
original work. Cooldown stays in execute; collection receives a fresh timestamp.
Target-runtime artifact bytes are carved from existing output/collect allowances,
not an extra grant. See [sampler contract](../design/lld/target-sampling.md).

## Actual native evidence

An authorized local workload used28 weighted endpoints, two published JSON bodies
of714243/714237 bytes, constant-arrival30/s for180s,15 preallocated/max60 VUs,
and60s post-load target observation. It ran as one isolated attempt with1CPU,
512MiB,128 PIDs,300s and64MiB output ceilings. The same saved revision remained
immutable across the preparation correction and explicit retry.

The final application state/outcome finished/passed; engine validation passed.
Verified result evidence reports30 required assertions passed, zero failed/unknown.
Published totals record5400 HTTP requests, zero HTTP failures from5400 rate samples,
and one dropped iteration. Totals are complete. Five artifacts published: metric
windows/index, native summary, numeric-final and target-runtime. The target artifact
was101253 bytes, read through authenticated content delivery and checked against
its published byte count/SHA-256. It held121 valid observations: one before,
90 during and30 after; no unavailable samples or retention limitation.

Backend/frontend/agent images were built from1fc4598; the corrected engine image
was built froma866724. Unchanged component sources were reused. Runtime catalogue
versions2/3 retained the same installation, namespace, workspace and stored data;
private versioned Compose/config overlays preserved original installation files.
Backups precede each serving change. This does not qualify a general installer
upgrade or cold-restore workflow.

## Failures and scoped verification

The first native attempt stopped during preparation because the native serializer
still refused large strings. No native workload script was produced. The failed
run was preserved; the corrected engine executed an explicit new run of the same
revision. Exact payload prebuild produced1467010 script bytes/2919070 peak bytes,
below the unchanged4MiB prepare allowance. An unused dirty-source image was
recorded/discarded before application; final packaging checked a clean source.

Focused checks covered large JSON/text round-trip and Unicode/escaping, input
integrity, unchanged dataset/template/aggregate limits, body manifests, sampler
lifecycle/failures, custody/output accounting and nonzero-cooldown phase timing.
The worker sampler suite passed16 cases; its startup listener regression passed.
Compiler/dataset scope passed48 cases; config timing/path scope7; domain pins4;
wrapper boundaries19; integration/lifecycle15 plus the selected cooldown regression.
Native serialization/build-budget/depth scope passed26, followed by4 serializer
cases after second-pass admission hardening. Node types, changed-file lint and
source/document structure passed; no full suite or unchanged-image rebuild repeated.
Independent source review caught cleanup/timestamp defects and accepted their
corrections, including body-only serialization and second-pass admission.

## Limits

Target stats are available as a verified artifact through existing downloads;
custom target charts and baseline-return heuristics remain pending. The legacy
script's extra hard-coded three-minute teardown/report and error-counter threshold
were not imported. The configured HTTP workload, payloads and four-minute target
observation period were retained; endpoint check conditions became required checks.
No production target, native amd64, telemetry overhead or clean-environment
performance comparison is claimed. Source changes contain only synthetic fixtures;
private inputs, configs, credentials and operational evidence remain local.
