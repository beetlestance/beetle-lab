import { expect, it } from 'vitest';
import { command, requestId, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
const create = (id: number, slug: string) =>
  command({ kind: 'createOrganization', id: uuid(id), request: { requestId: requestId(), scope: { kind: 'installation' }, name: `Org ${id}`, slug } });

it('refuses a slug another organization holds with a field-level code, leaving no row or receipt', async () => {
  const metadata = await fixture.open(fixture.path());
  try {
    await metadata.namespaces.execute(create(1, 'team'));
    await expect(metadata.namespaces.execute(create(2, 'team'))).rejects.toMatchObject({ code: 'organization_slug_conflict' });
    await metadata.namespaces.execute(create(3, 'other'));
  } finally {
    await fixture.close(metadata);
  }
});
