import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {sourceInputs, sourceTreeFile} from './inputs.js';
import {SourceDownloads} from './fetch.js';
import {collectAlpine, collectUpstream, collectNpm} from './assets.js';
import {archiveProducer} from '../producer.js';
import {candidateRoles} from '../identity.js';
import {copySourceReport} from './reports.js';
import {bundleSources} from './bundle.js';
const notice = `# Beetle Lab distribution sources and notices

Beetle Lab's source is MIT licensed. The included image distribution also contains
third-party software with its own licenses, including k6 under AGPL-3.0-only.
Those licenses do not relicense Beetle Lab's independent source.

manifest.json identifies the exact candidate, runtime sources, installed OS
origins, build recipes, patches and production npm package tarballs. Source archives
retain upstream copyright, LICENSE, COPYING and NOTICE files. The reports directory
contains image license inventories and CycloneDX SBOMs. Retain the applicable
notices when redistributing; inspect each component's included license.

The Alpine recipes are pinned by commit and file Git hashes, and all declared
source inputs are verified against their SHA512 sums. The original same-directory
recipe symlink is preserved; source scripts are never evaluated during collection.
The k6 commit was recovered from the unmodified ARM64 binary's Go build info; its
binary hash is explicitly ARM64. Both native scans must report its runtime version.
Node and nginx versions must match all twelve inspected candidate configurations.

The Beetle Lab source archive includes its exact Dockerfiles, dependency lockfile
and build instructions. Alpine recipes supply their build and patch instructions;
upstream archives supply their component documentation. This is source delivery,
not a claim of reproducible builds or certification of every downstream use.
`;
async function copyReports(staging: string, payload: string): Promise<void> {
  const reports = join(payload, 'reports'); await mkdir(reports, {mode: 0o700});
  let remaining = 32 * 1024 ** 2;
  for (const arch of ['amd64', 'arm64']) for (const role of candidateRoles) for (const kind of ['cdx', 'licenses']) {
    remaining -= await copySourceReport(join(staging, arch, 'supply-chain', `${role}.${kind}.json`),
      join(reports, `${arch}-${role}.${kind}.json`), remaining);
  }
}
async function main(): Promise<void> {
  const [staging, output, extra] = process.argv.slice(2);
  if (!staging || !output || extra || ![staging, output].every(path => isAbsolute(path) && path.length <= 4096)) throw Error('Expected staged delivery and new absolute output directory');
  const inputs = await sourceInputs(staging); await mkdir(output, {mode: 0o700});
  const payload = join(output, 'sources'); await mkdir(payload, {mode: 0o700});
  const alpine = join(payload, 'alpine'); const upstream = join(payload, 'upstream'); const npm = join(payload, 'npm');
  for (const directory of [alpine, upstream, npm]) await mkdir(directory, {mode: 0o700});
  const downloads = new SourceDownloads();
  for (const source of inputs.catalog.alpine) {await collectAlpine(source, join(alpine, source.origin), downloads);
    console.log(JSON.stringify({source: source.origin, verified: true}));}
  for (const source of inputs.catalog.upstream) {await collectUpstream(source, upstream, downloads);
    console.log(JSON.stringify({source: source.name, verified: true}));}
  let packages = 0;
  for (const source of inputs.npm) {await collectNpm(source, npm, downloads);
    if (++packages % 20 === 0) console.log(JSON.stringify({npmSources: packages, verified: true}));}
  await archiveProducer({executable: 'git', args: ['archive', '--format=tar', `--prefix=beetle-lab-${inputs.revision}/`, inputs.revision],
    destination: join(payload, 'beetle-lab-source.tar'), maximumBytes: 64 * 1024 ** 2});
  await copyReports(staging, payload);
  await writeFile(join(payload, 'README.md'), notice, {flag: 'wx', mode: 0o644});
  await writeFile(join(payload, 'LICENSE-beetle-lab'), sourceTreeFile(inputs.revision, 'LICENSE'), {flag: 'wx', mode: 0o644});
  await writeFile(join(payload, 'manifest.json'), JSON.stringify(inputs, null, 2), {flag: 'wx', mode: 0o644});
  await bundleSources(inputs, payload, output, downloads.status().bytes);
}
main().catch(() => {console.error('Image source collection failed; private partial files are not publication authority.'); process.exitCode = 1;});
