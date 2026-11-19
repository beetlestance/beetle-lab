import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { encodeLiveMetricHistory, liveMetricSubsetText } from '@beetle/contracts/api';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import {
  captureOutputAbsence,
  encodeStoppedHistoryClosure,
  encodeStoppedDeliveryHistory,
  STOPPED_HISTORY_ENVELOPE_BYTES,
} from '@beetle/contracts/output-source';
import type { StoppedDeliveryHistory, StoppedHistoryClosure } from '@beetle/contracts/output-source';
import { createRunnerGateway } from '../../../app/src/adapters/outbound/runner/index.js';
import { createAgentServer } from '../../../agent/src/transport/index.js';
import { identity, loaded, loopback } from '../../../app/test/runner/fixtures.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const { organizationId, workspaceId, attemptId } = identity;
const key = { organizationId, workspaceId, attemptId, generation: 1 };
const sourceRoute = `/runner/v1/attempts/${attemptId}/source`;
const unused = async (): Promise<never> => {
  throw new Error('Unexpected service call');
};

function closed(): StoppedHistoryClosure {
  const approval = createK6LiveApproval({
    source: { requests: [{ id: 'example', assertions: [] }] },
    scope: key,
    assignment: { specDigest: hash('spec'), intentDigest: identity.intentDigest },
    hash,
  });
  const history = {
    scope: key,
    producerEpoch: approval.producerEpoch,
    subset: approval.subset,
    subsetDigest: hash(liveMetricSubsetText(approval.subset)),
    prefix: {
      scope: key,
      windows: 1,
      endTimeMs: 1000,
      data: {
        artifactId: '00000000-0000-4000-8000-000000000010',
        relativePath: 'metric-windows.ndjson',
        bytes: 128,
        sha256: hash('data'),
      },
      index: {
        artifactId: '00000000-0000-4000-8000-000000000011',
        relativePath: 'metric-index.ndjson',
        bytes: 128,
        sha256: hash('index'),
      },
    },
    sampled: false,
    samples: [{ sequence: 1, startTimeMs: 0, endTimeMs: 1000, series: [] }],
  };
  const json = Buffer.from(encodeLiveMetricHistory(history, hash, key)).toString();
  return {
    absence: captureOutputAbsence({
      ...identity,
      version: 1,
      finalAgentSeq: 4,
      admission: { state: 'released', disposition: 'settled' },
      reason: 'artifact_incomplete',
    }),
    observation: { json, digest: hash(json), bytes: Buffer.byteLength(json) },
  };
}

function delivered(): StoppedDeliveryHistory {
  return {
    delivery: {
      version: 1,
      finalAgentSeq: 4,
      receipt: {
        version: 1,
        key: { ...key, generation: 1 },
        journalAuthority: identity.journalAuthority,
        manifestDigest: hash('manifest'),
        sourceDigest: hash('source'),
      },
    },
    observation: closed().observation,
  };
}

function serving(record: StoppedHistoryClosure | null, delivered: StoppedDeliveryHistory | null = null) {
  const read = vi.fn(async () => record);
  const readDelivery = vi.fn(async () => delivered);
  const app = createAgentServer({
    journalAuthority: identity.journalAuthority,
    installation: {
      enqueue: unused,
      enqueueExport: unused,
      cancel: unused,
      cancelOriginal: unused,
      cancelExportOriginal: unused,
    },
    capabilities: unused,
    credential: loaded().token,
    absences: { readOutputAbsence: async () => record?.absence ?? null, readStoppedHistoryClosure: read },
    deliveries: { readStoppedDeliveryClosure: readDelivery },
    journal: {
      get: async () => ({
        ...key,
        protocolVersion: '1.0',
        intentDigest: identity.intentDigest,
        retainedStartSeq: 0,
        cancelRequested: false,
        state: 'exited',
        lastSeq: 4,
        admission: { state: 'released', disposition: 'settled' },
        exitEvidence: { exitCode: 137, oomKilled: true, observedAt: '2026-01-01T00:00:00Z' },
      }),
      readEvents: unused,
      acknowledge: unused,
    },
  });
  return { read, readDelivery, app };
}

it('round trips one exact closure and its canonical observation over native agent HTTP', async () => {
  const record = closed();
  const { app, read } = serving(record);
  const gateway = createRunnerGateway(loaded(await app.listen({ host: '127.0.0.1', port: 0 })));
  try {
    expect(await gateway.output(identity).stoppedHistory!()).toEqual({ ok: true, value: record });
    expect(read).toHaveBeenCalledExactlyOnceWith(key);
  } finally {
    await gateway.close();
    await app.close();
  }
});

it('distinguishes pending closure from committed absence without observations', async () => {
  for (const record of [null, { ...closed(), observation: null }]) {
    const { app } = serving(record);
    const gateway = createRunnerGateway(loaded(await app.listen({ host: '127.0.0.1', port: 0 })));
    try {
      const reply = await gateway.output(identity).stoppedHistory!();
      if (record) expect(reply).toEqual({ ok: true, value: record });
      else
        expect(reply).toMatchObject({
          ok: false,
          error: { kind: 'protocol', status: 409, protocol: { reason: 'source_pending' } },
        });
    } finally {
      await gateway.close();
      await app.close();
    }
  }
});

it.each(['/absence/history', '/history'])(
  'rejects untrusted authority for %s before journal access',
  async (suffix) => {
    const { app, read, readDelivery } = serving(closed(), delivered());
    try {
      const origin = await app.listen({ host: '127.0.0.1', port: 0 });
      const response = await fetch(new URL(sourceRoute + suffix, origin), {
        headers: {
          authorization: `Bearer ${loaded().token}`,
          'x-beetle-organization-id': organizationId,
          'x-beetle-workspace-id': workspaceId,
          'x-beetle-generation': '1',
          'x-beetle-journal-authority': attemptId,
        },
      });
      await response.arrayBuffer();
      expect(response.status).toBe(409);
      expect(read).not.toHaveBeenCalled();
      expect(readDelivery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  },
);

it.each(['digest', 'sequence', 'oversize'])('rejects a corrupt %s response', async (issue) => {
  const record = closed();
  const valid = encodeStoppedHistoryClosure(record, { ...identity, generation: 1 }, hash);
  const body =
    issue === 'digest'
      ? valid.replace(record.observation!.digest, 'f'.repeat(64))
      : issue === 'sequence'
        ? valid.replace('"finalAgentSeq":4', '"finalAgentSeq":0')
        : '';
  const runner = await loopback((_, response) => {
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-length': issue === 'oversize' ? STOPPED_HISTORY_ENVELOPE_BYTES + 1 : Buffer.byteLength(body),
    });
    response.end(body);
  });
  const gateway = createRunnerGateway(runner.loaded);
  try {
    expect(await gateway.output(identity).stoppedHistory!()).toMatchObject({ ok: false, error: { kind: 'response' } });
  } finally {
    await gateway.close();
    await runner.close();
  }
});

it.each(['observed', 'no observations', 'pending', 'absent', 'stale sequence'] as const)(
  'distinguishes %s for source companion history',
  async (state) => {
    const value = delivered();
    const record =
      state === 'no observations'
        ? { ...value, observation: null }
        : state === 'stale sequence'
          ? { ...value, delivery: { ...value.delivery, finalAgentSeq: 3 } }
          : state === 'observed'
            ? value
            : null;
    const { app, readDelivery } = serving(state === 'absent' ? closed() : null, record);
    const gateway = createRunnerGateway(loaded(await app.listen({ host: '127.0.0.1', port: 0 })));
    try {
      const reply = await gateway.output(identity).stoppedDeliveryHistory!();
      if (state === 'observed' || state === 'no observations') expect(reply).toEqual({ ok: true, value: record });
      else
        expect(reply).toMatchObject({
          ok: false,
          error: {
            kind: 'protocol',
            protocol: {
              reason:
                state === 'pending' ? 'source_pending' : state === 'absent' ? 'source_absent' : 'invalid_protocol',
            },
          },
        });
      expect(readDelivery).toHaveBeenCalledExactlyOnceWith(key);
    } finally {
      await gateway.close();
      await app.close();
    }
  },
);

it.each(['intent', 'source digest', 'observation digest'])(
  'rejects a source companion with a corrupt %s',
  async (issue) => {
    const record = delivered();
    const valid = encodeStoppedDeliveryHistory(record, { ...identity, generation: 1 }, hash);
    const body =
      issue === 'intent'
        ? valid.replace(identity.intentDigest, 'f'.repeat(64))
        : issue === 'source digest'
          ? valid.replace(record.delivery.receipt.sourceDigest, 'invalid')
          : valid.replace(record.observation!.digest, 'f'.repeat(64));
    const runner = await loopback((_, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      response.end(body);
    });
    const gateway = createRunnerGateway(runner.loaded);
    try {
      expect(await gateway.output(identity).stoppedDeliveryHistory!()).toMatchObject({
        ok: false,
        error: { kind: 'response' },
      });
    } finally {
      await gateway.close();
      await runner.close();
    }
  },
);
