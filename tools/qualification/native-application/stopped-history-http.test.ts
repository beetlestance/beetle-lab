import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { encodeLiveMetricHistory, liveMetricSubsetText } from '@beetle/contracts/api';
import { createK6LiveApproval } from '@beetle/contracts/k6-live';
import {
  captureOutputAbsence,
  encodeStoppedHistoryClosure,
  STOPPED_HISTORY_ENVELOPE_BYTES,
} from '@beetle/contracts/output-source';
import type { StoppedHistoryClosure } from '@beetle/contracts/output-source';
import { createRunnerGateway } from '../../../app/src/adapters/outbound/runner/index.js';
import { createAgentServer } from '../../../agent/src/transport/index.js';
import { identity, loaded, loopback } from '../../../app/test/runner/fixtures.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const { organizationId, workspaceId, attemptId } = identity;
const key = { organizationId, workspaceId, attemptId, generation: 1 };
const route = `/runner/v1/attempts/${attemptId}/source/absence/history`;
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

function serving(record: StoppedHistoryClosure | null) {
  const read = vi.fn(async () => record);
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
  return { read, app };
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

it('rejects untrusted authority before invoking the durable history owner', async () => {
  const { app, read } = serving(closed());
  try {
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(new URL(route, origin), {
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
  } finally {
    await app.close();
  }
});

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
