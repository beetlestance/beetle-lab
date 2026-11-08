# Installed execution runtime

Status: implemented and independently reviewed component;
[local evidence](../../verification/agent-runtime.md). This owns composition, not new lifecycle rules.
Public entrypoint: `agent/src/bootstrap/index.ts`.

One runtime per process owns the exclusively opened journal, installed Stagers,
Supervisor, InstallationController, output/timeout guards, resource observer,
observation publisher, Scheduler and private HTTP server. It never substitutes
fake backends, observations, schema validators or execution results. Trusted
configuration supplies a catalogue, Docker transport, input/secret providers,
installation mount/image pins, policy, mounted credential and journal location.
The executable loader must construct these from bounded installation configuration;
this composition API is not a job-supplied dependency container.

Reserve the process owner before reading options or invoking foreign services.
Verify the actual installation root/agent/daemon binding before opening the journal.
Read-only exact-digest image inspection also checks each installed engine's local
image ID, full environment, Linux architecture matching the daemon, runtime and
absence of inherited volumes. Missing/mismatched images fail before opening the
journal; no implicit pull, emulation or tag selection. These local IDs are distinct
from a registry's multiarchitecture manifest digest.
Journal opening clears old observations. Derive approved profiles from the installed
catalogue, then configure admission without dropping existing attempts/charges.
Each installed engine gets a Stager bound to the same verified root and providers.
No raw paths, flags or launch capabilities come from HTTP jobs.

Construct actual DockerBackend instances through Supervisor. Bind system-stop
callbacks to the same InstallationController; start guards before the publisher,
then start scheduling charged recovery and queued work. Initial readiness is the
publisher's actual committed result; transient unknown capacity may recover while
the private server remains available. No constructor grants admission readiness.
The caller owns HTTP listening and must close a returned runtime if listen fails.
Status reports retained actor owners and outstanding scheduler work; these are
ownership counts, not measurements of running processes or resource consumption.

Capabilities describe installation policy ceilings clipped by the latest actual
daemon observation, reserve/headroom and per-run limits. They are advisory, not a
reservation or proof a particular engine/config can run. Return unavailable when
the publisher or latest actual resource evidence is unavailable. PID/output limits
remain configured policies; no physical PID, idle or thermal measurement is invented.
The one cached resource frame serves capabilities only; the journal remains the
single admission authority. Engine pins/capabilities come from the installed catalogue.

Shutdown synchronously fences new scheduling/intake and starts server, publisher,
scheduler, installation and staging shutdown independently. Retain every original;
never return early after one rejection. After those drain, close guards and observer.
Close the journal only if all owned runtime cleanup/revocation succeeded. Unknown
runtime or failed cleanup rejects clean close and retains the process owner/journal;
the caller must not report clean shutdown or reopen execution under another owner.
Known stopped reservations may remain charged pending collection/reconciliation;
clean local shutdown is not proof that every reservation was released.
Partially initialized startup follows the same draining path. At most one failed
startup/runtime owner is retained, so repeated failures cannot accumulate owners.

A startup AbortSignal fences continuations after every original asynchronous step;
it does not detach verification or journal-opening work. Transport socket lifetime
remains owned by the executable transport binding; this API cannot certify remote
Docker requests quiesced. Shutdown is not an artifact ACK or deletion permission.

Acceptance covers actual verification/journal/components/private HTTP composition,
real staged execution with a controlled daemon, unavailable capacity, one-owner
fencing, failed/aborted startup cleanup, listening failure and retained unknown
runtime shutdown. Container entrypoint, native mount visibility, architecture matrix,
stack overhead and full-pool stop latency require separate qualification.
