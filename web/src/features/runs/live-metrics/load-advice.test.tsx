// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {activeRun,deferred,flush,session,surface,value} from './ui-fixtures.js';
import type {LiveMetricReads} from './read.js';
afterEach(()=>{cleanup();vi.useRealTimers();});
it('retires dropped-load advice on source expiry without issuing an extra advice read',async()=>{
 vi.useFakeTimers();const current=activeRun();const initial=value(current,9);
 initial.frame.series[0]!.metric='dropped_iterations';initial.frame.series[0]!.tags={};
 initial.frame.subset.selected[0]!.metric='dropped_iterations';initial.frame.subset.selected[0]!.tags={};
 const held=deferred<ReturnType<typeof value>>();
 const read=vi.fn<LiveMetricReads['read']>().mockResolvedValueOnce(initial).mockImplementation(()=>held.promise);
 render(surface(session(),current,{read}));await flush();
 expect(screen.getByText('At least 9 dropped iterations observed in this live window.')).toBeInTheDocument();expect(read).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
 expect(screen.queryByText('Dropped load')).not.toBeInTheDocument();expect(screen.getByText(/Live metrics expired/)).toBeInTheDocument();expect(read).toHaveBeenCalledTimes(2);
});
