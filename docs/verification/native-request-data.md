# Native requests, data and assertions

Qualified sourceb48936d8 images, native ARM64 Docker Desktop, Node24.22.3 observer.
Two retained runs passed46.801s total; normal and independent exact-owner cleanup
passed. Shipped CPU/memory/PID/output/pool limits were unchanged. No image build,
user data, secrets or external target was used.

| Case | Native accepted observation |
| --- | --- |
| GET/POST/PUT/PATCH/DELETE | Exactly4 physical requests each. Path/query/header templates and JSON literal structure matched independent target checks. |
| Immutable files | JSON/CSV/body published through public create/byte append/seal/poll, then three exact digest/size references. PUT received exact text bytes; PATCH received the parsed JSON body. |
| Datasets | Inline random, JSON by-VU, CSV random and range by-VU resolved coherently. CSV included BOM, quoted comma, escaped quote and embedded newline. |
| Per-VU correlation | Synthetic by-VU identity range produced exact1–10, each with one stable method and2 requests. JSON parity and range position matched each identity; both JSON rows/all three range values observed. Random full coverage was not a probabilistic gate. |
| Assertions | All50 required definitions passed: status exact/family, body substring, header exists/equals/contains and JSON exists/equals/contains/compare. |
| Readiness | First response503, retry200; the later run received200. Exactly3 readiness requests across two runs. |
| Malformed response | Three HTTP200 invalid-JSON responses produced failed/exit99:5 required definitions passed,5 failed,0 unknown. No transport failure was invented. |
| Target totals |20 positive+3 malformed+3 readiness=26; zero target rejection. |

A separate bounded target script enforces method, row/header/body coherence and
per-identity request counts. Its source/compiled hashes are retained. Only its
reviewed <=16KiB output is mounted readonly; the observer port binds loopback.
The target caps128 requests,8192 body bytes,64 fragments and16KiB headers. Two
focused tests validate configuration and prove that mixed rows/oversized requests
are refused. Types, lint, architecture/docs and independent review passed.

The first37.368s attempt configured3 iterations against a2-request-per-VU cap.
All20 physical requests and50 definitions passed, then selection exhaustion
aborted k6 with108, exposed as inconclusive engine_crash (wrapper exit0/OOM=false).
That trial remains failed. The positive fixture now requests2 iterations, matching
its declared caps; the intended20 physical requests and all controls are unchanged.
This does not claim silent no-op semantics after selection exhaustion.

The [AMD finite profile](native-source-conformance.md) passed the same request/data cases on verifiedb48936d8 images. Secrets have [separate ARM evidence](native-secrets.md). This request packet excludes statistical weight/jitter
quality, every dataset bound and all A07 completion. This is sampled finite native
conformance, not a claim about arbitrary requests or target applications.
