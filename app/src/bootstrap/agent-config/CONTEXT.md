# Private agent configuration intake

Public entrypoint: `../agent-configuration.ts` exports
`loadAgentConfiguration(path, installationId): Promise<LoadedAgentConfiguration>`.
The existing runner port owns both file and captured-value shapes.

Inputs are an absolute canonical private JSON path and installation UUID. Output
is a deeply frozen configuration plus captured bearer token. Intake reads files;
it performs no environment discovery, network request, secret resolution or write.

JSON is bounded to 64KiB, token to 129 bytes, reads to 64 native calls per file,
and profiles to 1..32. Files must be canonical, UID-owned, private, single-link
regular files with stable path/handle identity and metadata. The token permits
43..128 bearer characters and one optional terminal LF.

Each loader admits one original intake without a queue. Config closes before
token opens. Original open/read/close promises settle before return or failure.
Failed close retains its descriptor and original promise, rejects startup and
permanently fences subsequent intake; it never retries or claims drainage.
Errors contain only a fixed rejection message.

`loader.ts` and `private-file.ts` expose a feature-local test construction seam;
production callers use only the public entrypoint with native operations.
Focused verification: `npm run test:v2 --
app/test/bootstrap/agent-configuration.test.ts app/test/bootstrap/agent-config
--maxWorkers=1`.
