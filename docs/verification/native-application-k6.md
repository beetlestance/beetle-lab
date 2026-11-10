# Native application, agent and k6

Status: locally verified functional slice, not release qualification.

## Tested source and environment

Harness source: `rewrite/native-app-harness` at `dc051f4`, integrated without source
changes. Application/agent source is `ad53195`; engine recipe correction `eeba3a6`
adds the engine schemas required by its existing bundle imports.

Host backend: macOS, Node26.7.0. Agent and engine: Node24 Linux containers on native
arm64 Docker Desktop, Docker29.9.2. This is not a shipped backend container test.

| Image | Local immutable ID |
| --- | --- |
| Agent | `sha256:70936987925d1c9431ce42249497dd192e505796f197c0d61ae24db0e6bdcb41` |
| k6 | `sha256:ffee668028c6086bd43bf02254dc42b7672c29b9de2506097bbc3e589e69f333` |

Both image revision labels use `ad53195`; the k6 recipe correction is separately
identified above. Private evidence records exact source/compiled worker hashes.
No image was published by this qualification.

## Actual path and observations

The manual [harness](../../app/test/container/README.md) performs explicit fresh
installation initialization using the real Journal authority and ready gate. It
starts the actual application, pairs a public API session, saves namespace/suite/
revision records and enqueues once through the public API. Normal capacity and
dispatch owners contact the real agent; only the agent starts the real k6 engine.

| Synthetic target | Public outcome | k6 exit / wrapper exit | Command elapsed |
| --- | --- | --- | --- |
| HTTP200, required assertion passes | finished / passed | 0 / 0 | 9.55s |
| HTTP500, required assertion fails | finished / failed | 99 / 0 | 7.46s |

Each case verified one engine execution, one readiness request, one work request
and zero unexpected target requests. It checked actual agent/public result
equality, sealed native output, downloaded artifact sizes/hashes, durable event
closure and full ACK, released execution reservation, terminal receipt and exact
storage credit. Closing/reopening metadata preserved public Run/result reads,
artifact facts and accounting. Exact-label container/network cleanup passed.

The retained payload charges were21672 and21762 bytes; each retained an additional
65536 bytes of metadata. Refunds were16755544 and16755454 bytes respectively, from
the original16777216-byte payload allocation. No test execution was retried.

## Corrections and limits

Earlier attempts exposed fixture/build issues: missing bundle schema inputs,
Docker local-log rotation requiring more than one file with compression, internal
network publication unavailable on this daemon, frozen Fastify listen options,
and omitted explicit fresh installation initialization. The final harness fixes
these without weakening production startup recovery or execution assertions.

One diagnostic container-log retrieval failed in each passing case. Required
result/artifact/accounting checks still completed; this evidence does not claim
complete container log capture. Private original diagnostic stderr also exposed
the earlier missing installation gate.

No browser interaction, backend container/Compose install, native amd64 execution,
concurrent load, crash during execution, source-free closure, resource abuse,
soak, scan or release qualification is established here. Metadata reopen after
settlement is narrower than restart recovery during execution.
