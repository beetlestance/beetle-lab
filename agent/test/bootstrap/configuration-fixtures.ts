import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { digest, credential } from './fixtures.js';
import type { AgentRuntimeOptions } from '../../src/bootstrap/index.js';
import type { PoolConfiguration } from '../../src/admission/index.js';

/** Installation-owned files with shared shipped k6 schema, not a fake validator. */
export async function configurationFiles(root: string, options: AgentRuntimeOptions) {
  const journal = join(root, 'journal'); const inputs = join(root, 'inputs');
  await mkdir(journal, { mode: 0o700 }); await mkdir(inputs, { mode: 0o700 });
  const token = join(root, 'credential'); const path = join(root, 'agent.json');
  await writeFile(token, credential, { mode: 0o600 });
  const schema = createK6ConfigSchema(digest);
  const { profiles: _profiles, ...configuration } = options.configuration as PoolConfiguration; void _profiles;
  const value = { version: 1, installation: options.installation, dockerSocket: join(root, 'docker.sock'),
    journalDirectory: journal, credentialFile: token, minimumFreeBytes: options.minimumFreeBytes,
    configuration, providers: { inputRoot: inputs, secretBindings: [] },
    engines: options.catalog.engines.map(engine => ({ manifest: { ...engine.manifest, schemas: { ...engine.manifest.schemas, config: schema.schemaId } },
      profile: engine.profile, configVersion: 1, manifestId: engine.validation.manifestId,
      profileId: engine.validation.profileId, catalogVersion: engine.validation.catalogVersion })),
    listen: { host: '127.0.0.1', port: 4312 } };
  const save = () => writeFile(path, JSON.stringify(value), { mode: 0o600 });
  await save(); return { path, token, value, save, inputs, journal };
}
