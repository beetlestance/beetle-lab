// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import type { InputRecord } from '@beetle/contracts/api';
import { ApiContext, InputTransferContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { ids, json, testClient, transfers, workspace } from '../input-upload/test-fixtures.js';
import { AddSampleFile } from './index.js';
import { freeName, samples } from './samples.js';

afterEach(cleanup);

function mount(names: string[], complete = true) {
  let record: InputRecord | undefined;
  const api = testClient((request) => {
    if (request.method === 'POST' && request.path.endsWith('/inputs')) {
      const body = validateApi('CreateInputRequest', request.body);
      if (!body.ok) throw new Error('Invalid synthetic create');
      record = {
        id: ids.folder,
        scope: body.value.scope,
        folderId: body.value.folderId ?? ids.root,
        name: body.value.name,
        sha256: body.value.sha256,
        bytes: body.value.bytes,
        offset: 0,
        version: 1,
        state: 'staging',
        reason: null,
      };
      return json(record, 201);
    }
    if (request.path.endsWith('/seal')) {
      record = { ...record!, state: 'published', version: record!.version + 2 };
      return json(
        {
          id: ids.folder,
          scope: record.scope,
          requestId: request.body?.requestId,
          operation: 'seal',
          acceptedVersion: Number(request.body?.expectedVersion) + 1,
        },
        202,
      );
    }
    return json(record);
  });
  const transfer = transfers();
  transfer.prepare.mockImplementation(async ({ file }) => ({
    ok: true,
    value: { sha256: 'a'.repeat(64), content: new Uint8Array(file.size) },
  }));
  transfer.append.mockImplementation(async ({ record: current, chunk }) => {
    record = { ...current, offset: current.offset + chunk.length, version: current.version + 1 };
    return { ok: true, value: record };
  });
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api.client}>
      <InputTransferContext.Provider value={transfer}>
        <QueryClientProvider client={createQueryClient()}>
          <AddSampleFile workspace={workspace()} names={names} complete={complete} onClose={onClose} />
        </QueryClientProvider>
      </InputTransferContext.Provider>
    </ApiContext.Provider>,
  );
  return { api, transfer, onClose };
}

it('generates the chosen sample and uploads it through the normal input workflow', async () => {
  const { api, transfer } = mount([]);
  fireEvent.click(screen.getByRole('radio', { name: /order-body\.json/ }));
  expect(screen.getByLabelText('Input name')).toHaveValue('order-body.json');
  fireEvent.click(screen.getByRole('button', { name: 'Add sample' }));
  expect(await screen.findByText('Upload complete. Published status is confirmed.')).toBeVisible();
  const prepared = transfer.prepare.mock.calls[0]![0].file as File;
  expect(prepared.name).toBe('order-body.json');
  expect(prepared.size).toBe(new TextEncoder().encode(samples[2]!.content()).byteLength);
  expect(JSON.parse(samples[2]!.content())).toHaveLength(20);
  const create = api.records.find((request) => request.method === 'POST' && request.path.endsWith('/inputs'));
  expect(create?.body).toMatchObject({ name: 'order-body.json', folderId: ids.root });
  expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
});

it('refuses a listed name and offers the next free one', () => {
  const { api } = mount(['users.csv', 'users-2.csv'], false);
  expect(screen.getByText('An input named users.csv already exists in this workspace.')).toBeVisible();
  expect(screen.getByText('Only names on the listed page are checked.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add sample' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Use users-3.csv' }));
  expect(screen.getByLabelText('Input name')).toHaveValue('users-3.csv');
  expect(screen.getByRole('button', { name: 'Add sample' })).toBeEnabled();
  expect(api.records).toHaveLength(0);
});

it('keeps fixed, deterministic sample content', () => {
  expect(samples.map((sample) => sample.name)).toEqual(['users.csv', 'product-ids.csv', 'order-body.json']);
  for (const sample of samples) expect(sample.content()).toBe(sample.content());
  const users = samples[0]!.content().trim().split('\n');
  expect(users).toHaveLength(101);
  expect(users[0]!.split(',')).toHaveLength(samples[0]!.columns);
  expect(freeName('order-body.json', new Set(['order-body-2.json']))).toBe('order-body-3.json');
});
