# Sanitized diagnostic history: local evidence

Candidate based on563be4a. Contract: [native diagnostics](../design/lld/native-diagnostics.md).
This implements safe final history, not original stderr replay or live native logs.
No user service, image or published default changed.

## Evidence scope

Final scoped lane:288 cases/38 files passed. After the UI type-narrowing correction,
five diagnostic UI/read cases passed again; Node/web/runtime types, generated
contract drift, scoped lint, architecture, docs and frontend/engine builds passed.
Agent/API builds and qualification-tool types/lint also passed. Failed type/doc
checks and one local-image BuildKit reference error remain in private evidence.

One real native check used Linux arm64 current engine/agent overlays and a macOS
backend. Before execution, all293 engine files and3 agent bundles were hash-verified
inside the images. The two-second, one-VU arrival workload emitted a real warning.
A424-byte diagnostic artifact retained one safe insufficient-VU record with complete
capture of189 native bytes. Public reads verified scope, length and SHA256;
metadata reopen preserved the result and exact downloaded artifact. Target counts
were one readiness, four work, zero unexpected. The check took11.504s, and its
owned containers/networks were removed. This is not amd64 or Linux-backend evidence.

Schema capture rejects raw fields, unknown enum values, impossible count/prefix and
severity/code relationships. A worst-size retained prefix with maximum counters
fits the actual32KiB encoded bound. UTF8 and byte overflow fail closed.

The one native parser is tested with split records and canary native messages,
unknown JSON fields, invalid UTF8/JSON, long lines, unterminated tails, interruption
and overflow. It preserves order/severity but only emits fixed safe enum codes.
The process observer test drains stderr before checking complete evidence.
Existing warning counts keep their distinct completeness meaning.

Attempt tests verify unchanged minimum admission, useful numeric allocation,
ordinary sealed diagnostic bytes/hash/descriptor, and no fabricated artifact when
a process had no diagnostic evidence. Existing target/live/phase and artifact
cases cover the adjusted output partitions and collection deductions.

The viewer starts only on user action, verifies ordinary artifact bytes/hash and
payload scope/attempt, and retires held replies on close/departure. It shows redaction
and capture loss, uses fixed text and requires explicit retry after verification
failure. Shared reader lifecycle/transport evidence retains its original scope.

Independent review requested exact retained-prefix and severity/code validation;
those checks and schema-valid contradictory-artifact fixtures were added.
Packaged native-browser/engine tests, live diagnostic transport and full release
secret/cancellation/retention/platform qualification remain separate acceptance work.
