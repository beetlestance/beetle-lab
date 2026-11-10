import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import { validateApi, RUN_ARTIFACT_CONTENT_ROUTE } from '@beetle/contracts/api';
import type { RunArtifactParams } from '@beetle/contracts/api';
import type { RunArtifactsReader } from '../../../../ports/run-artifacts.js';
import type { OutputByteStore } from '../../../../ports/output-bytes.js';
import { registerApiOperation } from '../api-route.js';
import { ApiFault, apiErrorResponse } from '../api-errors.js';
import { RequestLifetimes } from '../request-lifetimes/index.js';
import { header, selectRange } from '../byte-content.js';
import { sendArtifact } from './content.js';
import { listArtifacts } from '../../../../application/run-artifacts/index.js';
interface Options { reader: RunArtifactsReader; bytes?: Pick<OutputByteStore, 'read'>; authorize: onRequestAsyncHookHandler }
const scope = (p: {organizationId: string; workspaceId: string}) => ({kind: 'workspace' as const,
  organizationId: p.organizationId.toLowerCase(), workspaceId: p.workspaceId.toLowerCase()});
export function registerRunArtifactRoutes(server: FastifyInstance, options: Options): {close(): Promise<void>} {
  const owners = new RequestLifetimes(1);
  server.register(async metadata => {
    metadata.addHook('onRequest', options.authorize);
    registerApiOperation(metadata, 'listRunArtifacts', ({params, query}) => listArtifacts({id: params.runId,
      attemptId: params.attemptId, scope: scope(params), ...query}, options.reader));
  });
  server.register(async content => {
    owners.register(content); content.addHook('onRequest', options.authorize);
    content.route({method: 'GET', url: RUN_ARTIFACT_CONTENT_ROUTE, exposeHeadRoute: false,
      handler: async (request, reply) => {
        const parsed = validateApi('RunArtifactParams', request.params);
        if (!parsed.ok || Object.keys(request.query as object).length !== 0 || request.raw.httpVersion !== '1.1'
          || header(request, 'transfer-encoding') !== undefined || ![undefined, '0'].includes(header(request, 'content-length'))) {
          throw new ApiFault('malformed_request');
        }
        const params: RunArtifactParams = parsed.value; const owner = owners.forRequest(request);
        const bytes = options.bytes; if (!bytes) throw new ApiFault('storage_unavailable');
        const record = await owner.run(() => options.reader.getRunArtifact({id: params.runId.toLowerCase(),
          attemptId: params.attemptId.toLowerCase(), artifactId: params.artifactId.toLowerCase(), scope: scope(params)}));
        const ifRange = header(request, 'if-range'); const rangeHeader = header(request, 'range');
        const range = selectRange(ifRange === undefined || ifRange === `"${record.artifact.sha256}"` ? rangeHeader : undefined, record.artifact.bytes);
        if (range === false) return reply.header('Content-Range', `bytes */${record.artifact.bytes}`).code(416).send(apiErrorResponse('invalid_value').body);
        return sendArtifact({reply, owner, record, range, bytes});
      }});
  });
  return Object.freeze({close: () => owners.close()});
}
