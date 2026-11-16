import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {readQualifiedRun} from './github.js';
import {extractQualifiedArtifact} from './zip.js';
import {verifyStagedCandidate} from './staged.js';
function argumentsFor(argv: string[]) {
  const [rawRunId, revision, output, extra] = argv;
  if (!rawRunId || !/^\d{1,16}$/.test(rawRunId) || !revision || !output || extra
    || !isAbsolute(output) || output.length > 4096) throw Error('Expected run ID, full revision and new absolute staging directory');
  return {runId: Number(rawRunId), revision, output};
}
async function main(): Promise<void> {
  const {runId, revision, output} = argumentsFor(process.argv.slice(2));
  const proof = await readQualifiedRun(runId, revision);
  await mkdir(output, {mode: 0o700});
  const candidates = [];
  for (const architecture of ['amd64', 'arm64'] as const) {
    const directory = join(output, architecture); await mkdir(directory, {mode: 0o700});
    for (const kind of ['images', 'native', 'supply-chain', 'roundtrip'] as const) {
      const name = `rewrite-${kind}-${architecture}-${revision}`;
      const artifact = proof.artifacts.find(row => row.name === name); if (!artifact) throw Error('Missing selected artifact');
      const target = join(directory, kind); await mkdir(target, {mode: 0o700});
      await extractQualifiedArtifact(artifact, kind, target);
    }
    candidates.push(await verifyStagedCandidate(directory, revision, architecture));
    console.log(JSON.stringify({architecture, verified: true, images: 6}));
  }
  // This marker exists only after every ZIP and both candidate content chains verify.
  await writeFile(join(output, 'staged.json'), JSON.stringify({format: 'beetle-staged-delivery', version: 1,
    source: proof, candidates}, null, 2), {mode: 0o600, flag: 'wx'});
}
main().catch(() => {console.error('Qualified delivery staging failed; private partial files are not publication authority.'); process.exitCode = 1;});
