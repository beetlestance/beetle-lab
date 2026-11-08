# Installed input, secret and private-file intake

Status: frozen implementation contract; executable integration pending.
Public entrypoint: `agent/src/providers/index.ts`. The executable owns this service
outside the runtime composition and closes it alongside runtime shutdown.

`openInstalledProviders(ProviderOptions)` returns an InstalledProviders service.
`readPrivateFile(path, maximumBytes, signal?)` is the shared bounded intake used by
the installation config/credential loader and mounted-secret provider. It returns
Uint8Array; maximumBytes is an integer 1..262144. Paths come from installation
configuration, never from an HTTP job. Unknown paths, aliases and namespaces fail.
Errors contain only fixed reasons, never paths, environment values or secret text.

Configuration pins one existing canonical absolute inputRoot (<=1024 bytes, <=32
parent components), owned by the agent UID and private to it. Root identity and
canonical ancestry are rechecked around intake. No symlink parents or root aliases.
Directories for a specific input must already exist; providers never mkdir or write.
The layout is inputRoot/organizationId/workspaceId/inputId/sha256, using validated
lowercase UUIDs and the exact declared digest. The Stager still verifies streamed
byte count/hash against the admitted immutable Offer before publishing staged input.
This adapter supplies byte custody, not an application upload/metadata/authorization API.

Input acquisition returns a lazy single-consumer iterator. Do not open a descriptor
until its first next: staging may fail before it obtains an iterator. Each stream
uses fixed <=64KiB read/copy buffers, checks AbortSignal between original calls and
compares declared size with the named/open file. It never materializes the input.
End-of-stream and return close the original once. Return before first next performs
no file I/O. Concurrent next is rejected; return/close are cached and retain active
next/read/open originals rather than abandoning them after cancellation.

Private files use O_NOFOLLOW/O_NONBLOCK, regular single-linked files, matching UID,
no group/other permission bits, canonical non-symlink ancestry and checked named/
open identity. Capture bigint device/inode/size/mtime/ctime/mode/link/owner metadata;
recheck around reads, original close and named lookup. Changed/replaced files fail.
No FIFO, device, socket, directory, hard link or world-readable secret is accepted.
Metadata checks do not claim adversarial linearizability against the local admin.

Across all provider/config intake in one process, at most two original file leases
may exist; no waiting queue. Capacity remains occupied through original cleanup.
Failed close retains the handle/owner in that bounded registry and is never retried
or made reusable by GC. A materialized private read must not resolve/reject as
quiescent after failed close: retain its original pending so Stager quiescence cannot
release an uncertain secret read. Service close refuses clean completion on failure.
No detached timeout or retry of unknown native operations is permitted.

At most256 configured secret bindings are indexed by organisation/workspace/name/
provider/reference/version. Duplicate exact identities reject. UUID identities are
case normalized; secret names/references/versions remain case sensitive. Match the
complete admitted reference; never use a request's alias as an environment key or
file path directly. Unversioned references match only unversioned bindings; versions
are operator assertions, not authenticated content identities.

Providers are env or mounted, matching the existing wire contract. Environment
sources are explicit valid variable names; read only the matching own data property
at resolution time, measure UTF-8 before allocating, and reject missing or >64KiB
values. Mounted sources use the same private-file intake capped at64KiB. Never trim
or normalize secret bytes, resolve shell substitutions, persist values or log them.
Request and config capture selects bounded fixed fields without invoking accessors
or enumerating unrelated caller keys. Known accessors/non-JSON values reject.

Close synchronously fences new intake and aborts all owned leases; independently
returns/drains streams and secret originals. Late opens are adopted and closed.
Service lifetime keeps failed owners reachable; no reset hook or false cleanup proof.
It does not close the journal, delete input/output files or release capacity.

Acceptance: real scoped streamed files and env/mounted secrets; exact alias/version
and namespace isolation; digest/size mismatch through actual Stager; empty inputs;
lazy intake, early return, two-lease saturation, held opens/reads/close, abort and
reentrant close; failed-close retention; symlink/hardlink/special/mode/replacement
negatives; oversized config/credential/secret intake without unbounded allocation.
Controlled fault ports do not establish native filesystem latency guarantees.
