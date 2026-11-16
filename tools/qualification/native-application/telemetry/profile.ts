import assert from 'node:assert/strict';
import {createEngineCatalog} from '../../../../agent/src/catalog/index.js';
import type {Catalog} from '../../../../agent/src/catalog/index.js';
import {DockerBackend} from '../../../../agent/src/backends/docker/index.js';
import type {DockerTransport} from '../../../../agent/src/backends/docker/index.js';
import type {BackendPort} from '../../../../agent/src/supervisor/index.js';
import type {Mode} from './config.js';
const marker='BEETLE_K6_LIVE_METRICS_V2';
export function catalog(source:Catalog,mode:Mode){
 const base=source.engines.find(engine=>engine.manifest.schemas.result.endsWith('/engine-result'));assert(base);
 assert.equal(base.profile.liveMetricMailbox,true);
 const original=[base.profile.entrypoint.executable,...base.profile.entrypoint.arguments];
 const entrypoint={executable:'env',arguments:[...(mode==='on'?[marker+'=1']:['-u',marker]),...original]};
 return createEngineCatalog([{...base,manifest:{...base.manifest,entrypoint},profile:{...base.profile,entrypoint}}]);
}
export function backend(transport:DockerTransport,mode:Mode):BackendPort{
 const port=new DockerBackend(transport);return {
  ensureCreated:port.ensureCreated.bind(port),dispatchStartOnce:port.dispatchStartOnce.bind(port),inspect:port.inspect.bind(port),
  stop:port.stop.bind(port),kill:port.kill.bind(port),
  ...(mode==='on'?{sampleResources:port.sampleResources.bind(port),readMailbox:port.readMailbox.bind(port)}:{})};
}
