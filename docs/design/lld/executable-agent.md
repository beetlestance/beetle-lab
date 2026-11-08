# Agent executable and installation configuration

Status: implemented and reviewed; bundled Linux arm64 fixture smoke passed.
Real engine execution, Compose and architecture qualification remain pending.
The entrypoint is `agent/src/bootstrap/main.ts`; build ships main.js and worker.js
together. The released application's entrypoint remains separate.

Only BEETLE_AGENT_CONFIG_FILE selects configuration. It names an absolute canonical
private regular file, at most256KiB, decoded as fatal UTF-8 then bounded JSON. No
environment interpolation or remote schema/image resolution. Configuration version1
has installation, dockerSocket, journalDirectory, credentialFile, minimumFreeBytes,
configuration, providers, engines and optional listen. Unknown envelope keys reject.
The installed runtime/journal validates admission policy semantics before execution.

Installation contains the existing verified installation/daemon/agent-image/user/
staging pins. Each of at most32 engines supplies manifest, profile, configVersion,
manifestId, profileId and catalogVersion. The executable currently registers the
shipped k6 configVersion1 schema, deriving its actual shared-schema digest. Arbitrary
schema/code loading and other engine adapters are unsupported by this executable;
the runtime composition remains engine-independent and extensible through installed
catalogue registrations. No image tag or newer pin is silently selected on restart.
Startup qualifies the actual local engine image IDs/environment/platform/runtime
through read-only inspection before advertising that catalogue. Profiles pin local
image IDs returned by the pinned Docker API1.47 after pulling/building the required
platform. Do not infer that ID from registry metadata or build-log config hashes;
the daemon must resolve and return the pinned ID. Images declaring volumes reject.

The existing private canonical journalDirectory must belong to the process UID
and have mode0700. Journal filename is journal.sqlite. Mounted credential bytes
must be exactly43..128 URL-safe base64 characters; newline/whitespace rejects.
Read at most128 bytes with the shared private-file custody rules. Do not print it.
Provider configuration is the [installed provider contract](installed-providers.md):
one scoped immutable input tree and explicit env/mounted aliases, with no values in
config, offers or default logs. Providers have an externally owned draining close.

Listen defaults to loopback127.0.0.1:4312; allowed hosts are127.0.0.1, ::1 and0.0.0.0,
port1..65535. The wildcard address is for the private agent container network;
Compose must not publish its port to the host. The runner credential and existing
browser/header fences still apply. Unknown initial capacity is not fabricated or
treated as successful engine execution; private capability reads return unavailable.

Startup owns one original loading promise. SIGINT/SIGTERM caches shutdown before
aborting startup, waits for original loading/open/listen work, then independently
closes runtime and providers. Late initialized services are adopted and drained.
Startup/listen failure uses the same path and exits with failure, with fixed text
that contains no private path or secret. Uncertain runtime/cleanup may prevent clean
shutdown; Docker's eventual process termination is not certified remote quiescence.

The agent image bundles trusted JavaScript on BUILDPLATFORM and runs Node24 on the
target platform. No host node_modules, native build-host artifacts, sample configs,
credentials, inputs or outputs are copied into it. The default nonroot image user
must be overridden consistently when host staging ownership uses another UID:GID.
Only the agent gets the trusted daemon socket; engine images never receive it.

Acceptance requires bundled main/worker startup against an owned Unix HTTP fixture,
real private config/provider files, authenticated capabilities, abort/listen-failure
and SIGTERM cleanup; image inspection and actual agent-controlled engine execution
are separate native qualification. Both architectures, overhead, Compose and the
complete application dispatch/finalization path remain required work.
See [executable evidence](../../verification/agent-executable.md) for exact checks.
