# Native protected retention recovery

Status: qualified on Linux ARM64 agent/engine with a macOS backend running Node 26.7. This is
controlled local qualification, not an amd64, full-Linux-backend, production-image
release or browser-visual claim. The images are current payload overlays on verified
cached bases; exact payload hashes, inherited configuration and base layers matched.

## Exercised path

One real k6 execution against a synthetic target created actual published source.
An authenticated public manual preview captured the exact Run version and logical
debt; public status reported the installed driver available. The application then
closed, and the actual compiled metadata worker applied that immutable snapshot.
This split controls fault timing. The public Apply HTTP seam is separately qualified
in the workspace/parent TCP cases; this native command uses compiled-worker Apply.

The actual Root driver removed backend files, called authenticated runner cleanup
and stored its ACK. The peer dropped the committed agent settlement reply. Backend
debt stayed retained. After agent restart, exact cleanup/settlement replies replayed.
A backend commit reply was then withheld; actual worker abort/reopen recovered the
same permanent settlement and credit once. Batch completion came from that proof,
then explicit acknowledgement removed only its paid metadata records. Old Apply and
acknowledgement requests were refused after removal.

| Observation | Actual result |
| --- | ---: |
| Starting backend charge |301437 |
| Run logical estimate |169853 |
| Snapshot plus permanent epoch |131584 |
| Confirmed Run settlement credit |167293 |
| Charge after Run settlement |134144 |
| Snapshot acknowledgement credit |131072 |
| Final backend replay floor plus epoch |3072 |
| Agent permanent replay debt |4096 |
| Engine executions |1 |
| Target ready / work / unexpected requests |1 /1 /0 |
| Native elapsed time |22.463 seconds |

Independent bounded offline inspection checked exact scoped snapshot/epoch/progress
rows, canonical membership and charges, epoch survival, permanent replay rows,
zero agent holds and FK consistency. No caller-provided spare allowance was used.
Published output was empty, staging retained only the installation marker, and
engine/mailbox resources were absent. Final task cleanup succeeded without diagnostic
failures. User data and running installation services were not involved.

## Reproduction and evidence

Build the backend from the reviewed source and use source-matched local
qualification images. These local image tags are not published releases:

```sh
npm run build:api
node --import tsx tools/qualification/native-application/retirement/retention-smoke.ts beetle-retention-agent:2e3dd1b beetle-retention-engine:2e3dd1b 200 desktop-linux
```

The agent payload image was `c5911fdfa8c9450fc0eff9d77425b799dd42bdc37aa73a84eef712da4b6db23f`;
the engine payload image was `c23a89db8af82ff863c977cf802ccdf8647fe528a3dadccb5ff3feade952853e`.
Private evidence retains exact source/build hashes, image verification, complete run
JSON and logs. Independent source and evidence review accepted this scoped result.
Earlier no-task/rejected/admitted-before-staging evidence remains separate; this
command adds the prepared-source retention composition.
