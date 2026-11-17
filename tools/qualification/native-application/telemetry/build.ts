import assert from 'node:assert/strict';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'tsup';
import type { Fixture } from '../compose/fixture.js';
import { deliveryDigest } from '../../../delivery/files.js';
async function verifyBootstrap(path: string) {
  const file = await open(path, 'r');
  let bytes = 0;
  let tail = '';
  let bootstrap = false;
  let cases = false;
  try {
    const info = await file.stat();
    assert(info.isFile() && info.nlink === 1 && info.size <= 16777216);
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
      bytes += chunk.length;
      assert(bytes <= 16777216);
      const text = tail + chunk.toString();
      bootstrap ||= text.includes('telemetry.bootstrap');
      cases ||= text.includes('telemetry.completed');
      tail = text.slice(-64);
    }
    assert(bootstrap && cases, 'Compiled bootstrap must contain the actual qualification program');
  } finally {
    await file.close();
  }
}
/** Task-only overlay; no dependency installation, base pull or published tag. */
export async function overlay(f: Fixture, output: string) {
  const context = join(output, 'overlay');
  await mkdir(context, { mode: 0o700 });
  await build({
    entry: { container: resolve('tools/qualification/native-application/telemetry/container.ts') },
    outDir: context,
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    bundle: true,
    noExternal: [/.*/],
    shims: true,
    removeNodeProtocol: false,
    splitting: false,
    clean: false,
    banner: {
      js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);",
    },
  });
  await verifyBootstrap(join(context, 'container.js'));
  const base = 'beetle-qualification-base:' + f.instance;
  const tag = 'beetle-qualification-telemetry:' + f.instance;
  for (const reference of [tag, base])
    assert.equal(f.docker.run(['image', 'ls', '-q', '--filter', 'reference=' + reference]), '');
  await writeFile(
    join(output, 'overlay-owner.json'),
    JSON.stringify({ tag, base, baseImageId: f.imageIds.agent, project: f.project }),
    { flag: 'wx', mode: 0o600 },
  );
  const cleanup = () => {
    for (const reference of [tag, base])
      if (f.docker.run(['image', 'ls', '-q', '--filter', 'reference=' + reference]))
        f.docker.run(['image', 'rm', reference]);
  };
  try {
    f.docker.run(['image', 'tag', f.imageIds.agent!, base]);
    await writeFile(join(context, 'Dockerfile'), `FROM ${base}\nCOPY container.js /beetle/agent/container.js\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    f.docker.run([
      'build',
      '--network=none',
      '--pull=false',
      '--label',
      `dev.beetle.qualification=${f.project}`,
      '--tag',
      tag,
      context,
    ]);
    const images = f.docker.json<{ Id: string; Architecture: string }[]>(['image', 'inspect', tag]);
    assert.equal(images.length, 1);
    assert.equal(images[0]!.Architecture, f.architecture);
    return {
      tag,
      base,
      id: images[0]!.Id,
      bundle: await deliveryDigest(join(context, 'container.js'), 16777216),
      cleanup,
    };
  } catch (error) {
    try {
      cleanup();
    } catch (close) {
      throw new AggregateError([error, close], 'Overlay build cleanup failed', { cause: close });
    }
    throw error;
  }
}
