# Output transport value evidence

Status: locally verified and independently reviewed shared values and declared
ports. Source `1941150a8c3215d588c3ad1ad12fb67ec79c209e`, integrated at
`18f5fbe8893933eaeeec29f5511e9e175ef8edcb`.
Contract: [output transfer](../design/lld/output-transfer.md).

Runner JSON schemas now own public binding/core/manifest plus receipt/closure
structures. Public recursively readonly types derive from generated shapes;
private Journal closure aliases the same type. Existing semantic owners retain
manifest/result digest preimages, count relationships and separate byte caps.
No private root/runtime or Node dependencies enter the shared graph.

verifySourceEnvelope captures before callbacks, verifies the existing manifest
and matches its complete receipt scope/authority/digest tuple. It does not bind
a backend retained original or prove native closure. verifySourceChunk matches
request selectors and declared artifact length, checks canonical base64/pad bits
without decoding, and bounds safe end/EOF arithmetic. Bytes remain provisional
until native custody and backend whole-file hash verification succeed.

## Actual checks

175 focused cases passed across5 files, real2.89s:135 existing shared/private
source cases and40 new envelope/range cases. Two newly added typed error cases
passed separately0.93s; no full175-case rerun after readonly aliases/port declarations.
Changed11-file lint passed1.18s. Node TypeScript passed9.72s before final port
declarations, then7.32s after final aliases/ports. Generation produced56 outputs
in0.59s and0.19s after error additions. Architecture1334 files passed3.07s;
documentation217 files passed0.40s. No failing command, Docker/build/full suite.

Independent review matched all54 frozen inputs, found no blocker, took139s and
reused these checks. It inspected schema/reference compatibility, preserved golden
semantics, original ownership, envelope relationships and base64/length bounds.

## Remaining runtime work

Generated client methods perform structural transport only. The declared source
client/service ports are not runtime implementations. Gateway expected-original
matching, shared ordinary/source credits, per-operation response limits before
allocation, pre-body server credits, native range root/descriptor custody and actual
HTTP composition remain pending. Backend adoption/publication/final eligibility,
nonexecution closure, deletion and retention refund are separate required work.
No complete backend-to-k6-to-result or release qualification is established here.
