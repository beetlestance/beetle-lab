# Ordinary source Compose first boot

Status: reviewed local source implementation, native Linux arm64 verified.
Base e05d221; first-boot source candidate identified by its integration commit.
Contract: [first boot](../design/lld/compose-first-boot.md).

## Implemented behavior

Default docker-compose.yml builds separate frontend/backend/agent, installer and
performance/offline images. Fresh private state is initialized without a custom
launcher, manual configuration or pairing token. Only the frontend is published,
on127.0.0.1. Advanced compose.rewrite.yml and the previous compose.legacy.yml remain
explicit alternatives. Existing data and immutable installed image pins are retained.

The setup owns a separate configuration gate. It prepares only the finite empty
Docker-created directory skeleton, drops identity, then delegates to the existing
initializer. Ready checks reuse private receipt/configuration/image validation
without opening the serving Journal. The explicit agent bootstrap recipe verifies
its actual non-root PID1 identity and zero runtime capabilities before staging.

## Actual native proof

Docker29.9.2, Linux arm64; source images built in one capped task BuildKit lane.
A unique project, absent home, dynamic loopback port and capped synthetic target
were used. The public frontend proxy supplied the automatic session and all APIs.

- Fresh setup succeeded; agent catalogue contained performance and offline profiles.
- Ordinary k6 run passed with six artifacts and a hash-verified numeric download.
- Offline export produced a23321-byte script; downloaded bytes matched its SHA256.
- Exactly two engine containers stopped with exit0/noOOM,512MiB/1CPU/128PID caps;
  offline engine had networknone. Target received one readiness and one work call.
- Second up and explicit ready setup succeeded while serving owned the Journal.
- Backend/agent restart retained authority, credential hash, browser cookie,
  workspace settings version2, Run, export, script bytes and original enqueue replay.
- Actual backend/agent PID1 UID/GID were1000; agent effective capabilities werezero.
- Task engine/project containers and networks were removed; cleanup was verified.

The smoke made112 public requests. It neither used nor restarted an existing user
installation. No real target or credential was used.

## Scoped checks and retained failures

Installer integration:142 passed normally;14 launcher socket cases initially
failed with sandbox EPERM and passed with the required socket permission.
Compose home/gate/settlement, identity adoption, export catalogue/ready checks and
staging identity negatives have separate passing scoped records. Node types,
changed-source lint, architecture and documentation checks accompany the candidate.

Native failures were retained: malformed YAML tmpfs quoting; starter ownership
validation before privilege drop; configured-user verification incompatible with
explicit root bootstrap; qualification session exchange/error-envelope mistakes.
Corrections preserved the ownership/identity gates. Only affected images were
rebuilt; harness/prose corrections reused the existing images.

## Limits

This is source-build evidence, not published pull-install or release qualification.
No native amd64, real browser, in-flight crash, backup/restore, abuse/soak or full
release matrix is established. Automatic session lifetime remains its existing8h
policy. Docker socket access remains a trusted local execution boundary. Changing
installed image pins requires a separate update design, not silent reprovisioning.
