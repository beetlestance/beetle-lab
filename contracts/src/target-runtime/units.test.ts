import { expect, it, vi } from 'vitest';
import { captureTargetRuntimeUnits, targetUnitProjection, projectTargetReading, targetMetricNames } from './index.js';
import unitsSchema from '../../runner/v1/target-runtime-units.schema.json' with { type: 'json' };
import { validate } from '../validate.js';

it('shares one closed metric catalogue with dimension-compatible units', () => {
  expect(Object.keys(unitsSchema.properties).sort()).toEqual([...targetMetricNames].sort());
  for (const input of [{rss:'milliseconds'},{cpuPercent:'bytes'},{'gc.count':'seconds'},{'eventLoopDelay.p99':'percent'},{unknown:'bytes'}])
    expect(()=>captureTargetRuntimeUnits(input)).toThrow();
  expect(captureTargetRuntimeUnits({rss:'bytes',cpuPercent:'ratio','eventLoopDelay.p99':'nanoseconds','gc.count':'count'})).toBeDefined();
});

it('detaches and freezes declarations without invoking accessors', () => {
  const input={rss:'bytes'};const result=captureTargetRuntimeUnits(input);input.rss='megabytes';
  expect(result.rss).toBe('bytes');expect(Object.isFrozen(result)).toBe(true);
  const getter=vi.fn(()=> 'bytes');expect(()=>captureTargetRuntimeUnits({get rss(){return getter();}})).toThrow();expect(getter).not.toHaveBeenCalled();
});

it('converts compatible declared units exactly and leaves undeclared values raw', () => {
  const units=captureTargetRuntimeUnits({rss:'kibibytes',cpuPercent:'ratio','eventLoopDelay.p99':'nanoseconds'});
  const memory=targetUnitProjection(units,'rss');expect(memory.label).toBe('MiB');expect(projectTargetReading(1024,memory)).toBe(1);
  expect(projectTargetReading(0.5,targetUnitProjection(units,'cpuPercent'))).toBe(50);
  expect(projectTargetReading(1000000,targetUnitProjection(units,'eventLoopDelay.p99'))).toBe(1);
  expect(projectTargetReading(1000,targetUnitProjection(units,'rss','megabytes'))).toBe(1.024);
  const raw=targetUnitProjection(undefined,'rss');expect(raw.declared).toBe(false);expect(raw.label).toContain('not declared');expect(projectTargetReading(1024,raw)).toBe(1024);
  expect(projectTargetReading(0,memory)).toBe(0);expect(projectTargetReading(null,memory)).toBeNull();
  expect(projectTargetReading(Number.MAX_VALUE,targetUnitProjection(units,'cpuPercent'))).toBeNull();
  expect(projectTargetReading(Number.MIN_VALUE,targetUnitProjection(units,'eventLoopDelay.p99'))).toBeNull();
  expect(()=>targetUnitProjection(units,'rss','milliseconds')).toThrow();
});

it('rejects incompatible declarations through the report wire schema as well', () => {
  expect(validate('TargetRuntimeUnits',{rss:'seconds'}).ok).toBe(false);
});
