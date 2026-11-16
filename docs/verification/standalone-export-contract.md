# Standalone export job contract evidence

Status: locally verified assignment/result component; independent F15 workflow pending.
Source: feature commit containing this report, based on302a85a.
Owner: [export jobs](../design/lld/standalone-export-jobs.md).
No runnable profile, admission, public route, queue or native job is advertised.

A distinct purpose-tagged envelope wraps the existing Offer, source and request
identity. It requires the dedicated capability, k6/config1 and explicit empty
secret declarations. Existing performance Offer intake rejects that envelope.
Script runtime timeout is separate from whole-job timeout. Explicit build scratch
plus8KiB result/64KiB control stays inside original output budget. Nested Offer and
config byte limits are revalidated before digest work; captured values are frozen.

Generation result states never imply a passed performance test. Success requires
one fixed portable-script descriptor; failure/cancellation has no partial artifact.
Capture verifies full assignment/scope/digest, exact build/artifact bytes and peak
budget, and finite ordered timestamps. Seals/digests prove neither admission,
producer authentication, physical custody nor original-work quiescence.

Independent Python fixtures fix canonical assignment/result preimages and SHA256.
One bounded seal core now serves both result purposes; existing engine-result v1
public functions and golden bytes remain unchanged. Initial sixteen export/legacy
seal cases passed in7,609ms. New result correction cases passed in989ms; explicit
capability/missing declarations passed in940ms. The shared-vector lane passed two
new wire fixtures in1,036ms; source/inference conformance and source-size checks
passed in1,733ms. No old verification threshold was lowered.

Review found that RFC3339 leap seconds admitted by the structural timestamp schema
can become NaN in JavaScript. Two regressions reproduced incorrect acceptance
before finite parsing was required at the semantic ordering boundary. Result seal
time is now finite for every status, and success artifact time is finite before
ordering. Typechecking also caught optional secretReferences inherited from Offer;
this purpose now requires explicit declarations instead of inventing a default.

Changed lint passed in1,291ms, Node types10,230ms, web types5,059ms, architecture
5,660ms, generator drift546ms and the browser bundle1,343ms. This scoped browser
build checks the shared validator dependency; it is not browser job UI evidence.
Doc/link checks and all failure/command/exit logs accompany integration. Independent
source review accepted the timing/declaration corrections without rerunning checks.

Next comes one engine-owned operation using the existing staged loader/compiler
and builder, bounded native script custody and original-work cancellation/close
ownership. Dedicated agent purpose/admission, durable job replay/reconciliation,
publication/download, HTTP/UI/client and container qualification remain required.
No Docker, load target, installed capability or end-to-end export is claimed here.
