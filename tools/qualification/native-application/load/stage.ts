/** Reuse one native platform from an already successful source CI run. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {readQualifiedRun} from '../../../delivery/github.js';
import {extractQualifiedArtifact} from '../../../delivery/zip.js';
import {verifyStagedCandidate} from '../../../delivery/staged.js';
import {archiveProducer} from '../../../delivery/producer.js';
import {Docker} from '../../docker.js';
import {nativeArchitecture} from '../compose/fixture.js';
import {qualificationArchitecture} from '../../resources/values.js';
const [rawRun, revision, output, extra] = process.argv.slice(2);
assert(rawRun && /^[1-9][0-9]{0,15}$/.test(rawRun) && revision && /^[a-f0-9]{40}$/.test(revision) && output && isAbsolute(output) && !extra);
delete process.env.DOCKER_HOST; delete process.env.DOCKER_CONTEXT;
const daemon = new Docker('default').json<{OSType: string; Architecture: string}>(['info', '--format', '{{json .}}']);
assert.equal(daemon.OSType, 'linux');
const proof = await readQualifiedRun(Number(rawRun), revision);
const architecture = qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE);
nativeArchitecture(daemon.Architecture, process.arch, architecture);
await mkdir(output, {mode: 0o700});
for (const kind of ['images', 'native', 'supply-chain', 'roundtrip'] as const) {
  const artifact = proof.artifacts.find(row => row.name === `rewrite-${kind}-${architecture}-${revision}`); assert(artifact);
  const target = join(output, kind); await mkdir(target, {mode: 0o700}); await extractQualifiedArtifact(artifact, kind, target);
}
const bundle = await verifyStagedCandidate(output, revision, architecture);
await writeFile(join(output, 'owner.json'), JSON.stringify({source: proof, architecture, references: bundle.references}), {flag: 'wx', mode: 0o600});
await archiveProducer({executable: 'docker', args: ['--context', 'default', 'load', '--input', join(output, 'images', bundle.archive.name)],
  destination: join(output, 'load-private.log'), maximumBytes: 65536});
console.log(JSON.stringify({sourceRun: proof.runId, revision, architecture, qualifiedSource: true, images: 6}));
