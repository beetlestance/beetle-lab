# Installed execution runtime

Status: implementation in progress. This owns composition, not new lifecycle rules.
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
