# Engine standalone export component

Status: reviewed local engine component. HTTP job admission/download and UI
integration remain required for the complete F15 feature. No native k6 or release
qualification is claimed.

Source `7e11878` implements exportStandaloneScript through the existing runtime
builder; integration `049fdedb`. It captures scalar options, validates the
standalone timeout and required scratch allowance, refuses declared secrets before
build/file effects, and returns frozen path/byte/peak metadata. It neither copies
the compiler/runtime template nor resolves secret values. Caller owns admission,
fresh exclusive output directory and any unknown partial-failure cleanup.

Actual compileSuite and esbuild produce the file. Tests compare exact output and
byte/peak parity, run the generated bundle with synthetic network-free k6 adapters,
and exercise all seven executors, discovery thresholds, readiness, shared setup
deadline and embedded CSV/JSON/body data. Other cases cover scalar mutation/getters,
unsupported secret references, malformed/missing budgets, exact scratch peak,
one-byte-short refusal, cleanup and existing-script preservation.

The initial24-case run passed23 with one incorrect discovery-key oracle. Correcting
it to the accepted phase:execute metric key required no production change; only
that failed case reran and passed, real1.09s. Initial run real2.34s; changed-file
lint passed, real1.40s; affected Node types passed, real8.27s. These are scoped
outcomes, not a second whole-file run. Coordinator source review, independent of
the implementation author, took approximately41s plus a final hash/path audit.
It found no implementation blocker and reused the recorded checks.

The trusted compiled-plan precondition is explicit; shallow intake checks are not
an arbitrary-JS sandbox. No HTTP/UI action, artifact publication, portable secret
mode, real load-engine behavior or native architecture/resource evidence follows
from this component. Source/contract: [standalone export](../design/lld/standalone-export.md).
