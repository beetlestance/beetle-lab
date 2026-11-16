import {execFileSync} from 'node:child_process';
import {mkdir, writeFile, unlink} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {candidateRoles, maximumArchiveBytes} from './identity.js';
import {captureBundle} from './bundle.js';
import {deliveryDigest, readDeliveryJson} from './files.js';
import {archiveProducer} from './producer.js';
import {archiveConfigs, archiveMember} from './contents.js';
import type {Architecture} from './identity.js';
import type {DockerCommand} from './references.js';
function argumentsFor(argv: string[]) {
  if (argv.length !== 4 || argv.some(value => value.length > 4096)) throw Error('Expected bundle, new output, private socket and store root');
  const [bundle, output, socket, store] = argv as [string,string,string,string];
  if (![bundle,output,store].every(isAbsolute) || !/^unix:\/\/\/[A-Za-z0-9_./-]+$/.test(socket)) throw Error('Private absolute archive paths required');
  return {bundle, output, socket, store};
}
function verifyEmptyStore(command:DockerCommand,expected:{root:string;architecture:Architecture}):void {
  const info = JSON.parse(command(['info','--format','{{json .}}']).toString('utf8')) as {DockerRootDir?:unknown;Driver?:unknown;Architecture?:unknown;OSType?:unknown};
  const arch = info.Architecture === 'aarch64' ? 'arm64' : info.Architecture === 'x86_64' ? 'amd64' : info.Architecture;
  if (info.DockerRootDir !== expected.root || info.Driver !== 'vfs' || info.OSType !== 'linux' || arch !== expected.architecture) throw Error('Wrong archive proof daemon');
  if (command(['image','ls','--all','--quiet']).length || command(['ps','--all','--quiet']).length) throw Error('Archive proof store was not empty');
}
async function main() {
  const args = argumentsFor(process.argv.slice(2)); const bundle = captureBundle(await readDeliveryJson(join(args.bundle,'bundle.json')));
  const path = join(args.bundle,bundle.archive.name); const checksum = await deliveryDigest(path,maximumArchiveBytes);
  if (checksum.bytes !== bundle.archive.bytes || checksum.sha256 !== bundle.archive.sha256) throw Error('Archive transport hash mismatch');
  await mkdir(args.output,{mode:0o700}); const config = join(args.output,'docker-config'); await mkdir(config,{mode:0o700});
  const client = ['--host',args.socket,'--config',config];
  const command: DockerCommand = argv => execFileSync('docker',[...client,...argv],{timeout:15000,maxBuffer:262144,stdio:['ignore','pipe','pipe']});
  verifyEmptyStore(command,{root:args.store,architecture:bundle.architecture});
  await archiveProducer({executable:'docker',args:[...client,'load','--quiet','--input',path],destination:join(args.output,'load.log'),maximumBytes:65536});
  const restored = Object.fromEntries(candidateRoles.map(role => {
    const rows = JSON.parse(command(['image','inspect',bundle.references[role]]).toString('utf8')) as {Id?:unknown}[];
    if (rows.length !== 1 || rows[0]?.Id !== bundle.configs[role]) throw Error('Restored config identity mismatch');
    return [role,rows[0].Id];
  }));
  const saved = join(args.output,'roundtrip.tar');
  await archiveProducer({executable:'docker',args:[...client,'save',...Object.values(bundle.references)],destination:saved,maximumBytes:maximumArchiveBytes});
  const configs = archiveConfigs(archiveMember(saved),bundle.references,{...bundle,images:bundle.configs});
  for (const role of candidateRoles) if (configs[role] !== bundle.configs[role]) throw Error('Restored archive content changed');
  await unlink(saved);
  const result = {format:'beetle-image-roundtrip',version:1,status:'passed',revision:bundle.revision,architecture:bundle.architecture,
    sourceImageIds:bundle.images,configDigests:configs,restoredImageIds:restored,archiveSha256:checksum.sha256,store:'fresh-private-vfs'};
  await writeFile(join(args.output,'roundtrip.json'),JSON.stringify(result,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:'passed',architecture:bundle.architecture,images:6}));
}
main().catch(()=>{console.error('Isolated image archive round trip failed; private evidence is not release authority.');process.exitCode=1;});
