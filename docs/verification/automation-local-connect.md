# Automatic automation-client connection

Status: locally verified command and bundle; container qualification pending.
Source: feature commit containing this report, based onc2c7806.
Owner: app/src/client/cli; [contract](../design/lld/automation-client.md).

Connect uses the existing automatic local session exchange. It reads no startup
token, requires the automatic response mode, captures exactly one strict session
cookie and creates an exclusive0600 credential file. Endpoint, configured loopback
Origin/Host and session expiry remain bound. Pair uses the same capture/writer for
the explicit one-time-token profile. No new auth route, SQLite/engine capability,
credential overwrite, cookie parser, implicit reconnect or resource retry is added.

The client performs one HTTP call and prints only {connected:true}. Existing
credential files refuse before HTTP. Unknown grant/file outcomes produce fixed
secret-free diagnostics. An explicit connect retry with no file created reuses
or reconciles the server's original grant; run/cancel remain single-issue commands.
Cancellation cannot persist or publish a late grant.

Forty-one initial auth/option/connect cases passed forty and found one fixture
error: JavaScript's default parameter converted an intended absent accessMode into
automatic. A dedicated missing sentinel corrected that fixture; only the failed
case reran and passed in1,640ms. The new cancellation case passed in1,420ms. No
production authorization gate was relaxed.

Two actual TCP/compiled-worker cases passed in12,057ms. Automatic connect creates
private credentials and authorizes the generated namespace read. A lost reply
creates no credential file or automatic retry; explicit retry receives the same
cookie/view, and independent SQL after backend close confirms session version1.
The paired backend refuses connect without consuming its token, then the existing
pair command and authenticated read succeed. All credentials/services/files were
synthetic and task-owned; no load target or real engine was invoked.

Changed lint passed in1,090ms, Node types18,727ms, architecture12,566ms and the
backend/worker/automation bundle997ms. The function's closed command guard was
expressed as membership to keep complexity within the existing gate; its allowed
commands did not change. Independent source review found no concrete blocker.
Docs/link checks and preserved command/exit/failure logs accompany integration.

This is source/function/TCP and build evidence. It does not prove a rebuilt image,
published pull, packaged CLI execution, native architecture matrix or complete
release. Standalone export still requires its admitted job/API; normal one-command
Compose provisioning and final browser/image qualification remain pending.
