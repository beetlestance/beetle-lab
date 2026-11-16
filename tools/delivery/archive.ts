import {mkdir, unlink, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {candidateRoles, captureQualifiedImages, maximumArchiveBytes} from './identity.js';
import {deliveryDigest, readDeliveryJson} from './files.js';
import {archiveProducer} from './producer.js';
import {ArchiveNames} from './references.js';
import {archiveConfigs, archiveMember} from './contents.js';

function argumentsFor(argv: string[]) {
  if (argv.length !== 5 || argv.some(value => !value)) throw new Error('Expected revision, architecture, scans, outcome and new output directory');
  const [revision, architecture, scans, outcomeFile, output] = argv as [string, string, string, string, string];
  for (const path of [scans, outcomeFile, output]) if (!isAbsolute(path) || path.length > 4096) throw new Error('Absolute delivery path required');
  return {revision, architecture, scans, outcomeFile, output};
}
async function main() {
  const {revision, architecture, scans, outcomeFile, output} = argumentsFor(process.argv.slice(2));
  const outcome = await readDeliveryJson(outcomeFile);
  const inspections = Object.fromEntries(await Promise.all(candidateRoles.map(async role => [role, await readDeliveryJson(join(scans, `${role}.identity.json`))])));
  const qualified = captureQualifiedImages(revision, architecture, outcome, inspections);
  await mkdir(output, {mode: 0o700}); // Exclusive creation refuses overwrite/replay.
  const archive = join(output, 'images.tar');
  const names = new ArchiveNames(qualified.images);
  let uncompressedBytes: number; let configs;
  try {
    names.create(); names.verify();
    uncompressedBytes = await archiveProducer({executable: 'docker', args: ['--context', 'default', 'save', ...Object.values(names.references)], destination: archive, maximumBytes: maximumArchiveBytes});
    names.verify(); configs = archiveConfigs(archiveMember(archive), names.references, qualified);
  } finally {names.release();}
  await archiveProducer({executable: 'gzip', args: ['-1', '-c', archive], destination: archive + '.gz', maximumBytes: maximumArchiveBytes});
  const transport = await deliveryDigest(archive + '.gz', maximumArchiveBytes);
  await unlink(archive);
  const bundle = {...qualified, version: 2, references: names.references, configs, archive: {name: 'images.tar.gz', ...transport, uncompressedBytes}};
  await writeFile(join(output, 'bundle.json'), JSON.stringify(bundle, null, 2), {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({revision, architecture, images: candidateRoles.length, archiveBytes: transport.bytes, archiveSha256: transport.sha256}));
}
main().catch(() => {console.error('Qualified image archive failed; private partial files are not publication authority.'); process.exitCode = 1;});
