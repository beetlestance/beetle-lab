// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { validate } from '@beetle/contracts';
import { comparisonWarnings, validateApi, type RunResultSnapshot } from '@beetle/contracts/api';
import passed from '../../../../../contracts/fixtures/valid/passed-result.json' with {type:'json'};
import chartData from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with {type:'json'};
import { snapshot, testClient, json, catalogue, mountComparison, deferred } from './fixtures.js';
import { fixture, report } from '../target-observations/read-fixtures.js';
import { targetReportReads } from '../target-observations/read.js';
import { readComparisonTarget } from './target-read.js';
import { comparisonTargetSources, comparisonTargetCards } from './target-model.js';
import { ComparisonTargetRuntime } from './TargetRuntime.js';
afterEach(()=>{cleanup();vi.restoreAllMocks()});
function setup(){
 const item=snapshot().items[0]!;item.environment.targetSampler='configured';item.warnings=comparisonWarnings(item);
 const artifact=fixture().artifact;
 const checked=validate('EngineResult',{...passed,organizationId:item.run.scope.organizationId,workspaceId:item.run.scope.workspaceId,attemptId:item.run.activeAttemptId,artifacts:[artifact]});
 if(!checked.ok)throw Error('Invalid result fixture');
 const reply:RunResultSnapshot={id:item.run.id,scope:item.run.scope,activeAttemptId:item.run.activeAttemptId,result:checked.value};
 const f=testClient(()=>json(reply));const context={api:f.client,signal:new AbortController().signal,alive:()=>true};
 return {item,reply,context,f,artifact};
}
it('uses a single bound descriptor and never fetches disabled, retired, ambiguous or foreign-attempt reports',async()=>{
 const f=setup(),read=vi.fn(async()=>report());
 expect((await readComparisonTarget(f.context,f.item,{read})).status).toBe('ready');
 expect(read).toHaveBeenCalledWith(expect.objectContaining({params:expect.objectContaining({runId:f.item.run.id,attemptId:f.item.run.activeAttemptId,artifactId:f.artifact.artifactId})}));
 read.mockClear();f.item.environment.targetSampler='disabled';expect((await readComparisonTarget(f.context,f.item,{read})).status).toBe('disabled');expect(f.f.records).toHaveLength(1);
 f.item.environment.targetSampler='configured';await readComparisonTarget({...f.context,alive:()=>false},f.item,{read});
 f.reply.result!.artifacts.push({...f.artifact,artifactId:'00000000-0000-4000-8000-000000000099'});await readComparisonTarget(f.context,f.item,{read});expect(read).not.toHaveBeenCalled();
 f.reply.result!.artifacts=[f.artifact];f.reply.activeAttemptId=f.item.run.id;await readComparisonTarget(f.context,f.item,{read});expect(read).not.toHaveBeenCalled();
});
function measured(){
 const checked=validateApi('RunChartHistory',chartData);if(!checked.ok)throw Error('Invalid chart fixture');const chart=checked.value;
 const items=snapshot().items;const template=report();const r={...template,
 units:{usedHeapSize:'bytes',cpuPercent:'ratio','eventLoopDelay.p99':'microseconds',activeHandles:'count'} as const,
 samples:Array.from({length:3},(_,i)=>({...template.samples[0]!,observedAt:new Date(chartData.source.measurementSourceTimeMs+i*1000).toISOString(),phase:(['before','during','after'] as const)[i]!,values:{...template.samples[0]!.values,usedHeapSize:i===0?0:2000000,cpuPercent:.5,'eventLoopDelay.p99':1000,activeHandles:10}}))};
 const numeric={...fixture().artifact,kind:'numeric-final',artifactId:chartData.source.numericArtifactId,sha256:chartData.source.numericSha256};
 return {items,r,targets:new Map(items.map(i=>[i.run.id,{status:'ready' as const,report:r,numeric:{...numeric}}])),histories:new Map(items.map(i=>[i.run.id,{status:'loaded' as const,value:{...chart,id:i.run.id,scope:i.run.scope,attemptId:i.run.activeAttemptId}}]))};
}
it('binds native timing to the sealed numeric descriptor and compares declared same-metric units only',()=>{
 const f=measured();let sources=comparisonTargetSources(f.items,f.targets,f.histories);expect(sources).toHaveLength(2);
 let cards=comparisonTargetCards(sources);expect(cards.map(c=>c.series.length)).toEqual([2,2,2,2]);expect(cards[0]!.series[0]!.values[0]).toBe(0);expect(cards[0]!.series[0]!.values[1]).toBe(2);expect(cards[1]!.series[0]!.values[0]).toBe(50);expect(cards[2]!.series[0]!.values[0]).toBe(1);
 f.targets.get(f.items[1]!.run.id)!.numeric.sha256='f'.repeat(64);expect(comparisonTargetSources(f.items,f.targets,f.histories)).toHaveLength(1);
 f.targets.get(f.items[1]!.run.id)!.numeric.sha256=chartData.source.numericSha256;
 sources=comparisonTargetSources(f.items,f.targets,f.histories);cards=comparisonTargetCards(sources.map(s=>({...s,report:{...s.report,units:{usedHeapSize:'bytes' as const}}})));expect(cards[1]!.series).toHaveLength(0);
 f.r.samples[1]!.observedAt=f.r.samples[0]!.observedAt;expect(comparisonTargetSources(f.items,f.targets,f.histories)).toHaveLength(0);
});
it('renders four target plots with linked source-unit labels and explicit inspection links',()=>{
 const f=measured();render(<MemoryRouter><ComparisonTargetRuntime items={f.items} targets={f.targets} histories={f.histories}/></MemoryRouter>);
 expect(screen.getAllByRole('img')).toHaveLength(4);fireEvent.click(screen.getByText('Recorded source details',{selector:'summary'}));expect(screen.getAllByRole('link',{name:'Inspect this run’s target evidence'})).toHaveLength(2);expect(screen.getByText(/Source metric: usedHeapSize/)).toBeVisible();
});
it('retains a retired target-byte original and stops old peer work until actual settlement',async()=>{
 const f=setup();const value=snapshot();value.items[0]=f.item;
 const original=deferred<ReturnType<typeof report>>();const read=vi.spyOn(targetReportReads,'read').mockReturnValue(original.promise);
 const api=testClient(req=>req.path.endsWith('/comparisons')?json(value):req.path.endsWith('/result')?json(f.reply):json(catalogue()));
 const first=mountComparison(api.client);await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));first.unmount();expect(read.mock.calls[0]![0].signal.aborted).toBe(true);
 const next=testClient(req=>req.path.endsWith('/comparisons')?json(snapshot()):json(catalogue()));mountComparison(next.client);await act(async()=>{await Promise.resolve()});expect(next.records).toHaveLength(0);
 await act(async()=>original.resolve(report()));await screen.findByLabelText('Baseline metric');expect(api.records.filter(r=>r.path.endsWith('/result'))).toHaveLength(1);expect(next.records.length).toBeGreaterThan(0);
});

for(const condition of ['missed','limited'] as const)it(`keeps ${condition} target collection visible outside details`,()=>{
 const f=measured();if(condition==='missed')f.r.missed=1;else f.r.limited=true;
 render(<MemoryRouter><ComparisonTargetRuntime items={f.items} targets={f.targets} histories={f.histories}/></MemoryRouter>);
 const notes=screen.getAllByText(condition==='missed'?/1 missed/:/Collection was limited/);
 expect(notes).toHaveLength(2);for(const note of notes)expect(note).toBeVisible();
 expect(screen.getAllByRole('link',{name:'Inspect this run’s target evidence'})).toHaveLength(2);
});
it('does not show empty source details when no compatible target source exists',()=>{
 const f=measured();render(<MemoryRouter><ComparisonTargetRuntime items={f.items} targets={undefined} histories={f.histories}/></MemoryRouter>);
 expect(screen.queryByText('Recorded source details',{selector:'summary'})).not.toBeInTheDocument();
 expect(screen.getAllByText(/target report unavailable/)).toHaveLength(2);
});
