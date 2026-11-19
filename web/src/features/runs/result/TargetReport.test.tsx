// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiContext } from '../../../app/api.js';
import { testClient, json } from '../../../app/test-fixtures.js';
import { fixture, report } from '../target-observations/read-fixtures.js';
import { ResultTargetReport } from './TargetReport.js';

afterEach(cleanup);
function mount(read=vi.fn(async()=>report())) {
 const f=fixture();const api=testClient(()=>json({}));
 const view=render(<ApiContext.Provider value={api.client}><ResultTargetReport params={f.params} artifact={f.artifact}
  nativeOrigin={null} hover={{hoverT:null,onHover:vi.fn()}} reads={{read}} /></ApiContext.Provider>);
 return {...view,read,api};
}

it('uses one verified report for four charts and on-demand original values without a second read',async()=>{
 const f=mount();await screen.findByText(/recorded target observations/);
 expect(screen.getAllByRole('img')).toHaveLength(4);
 expect(screen.getByText(/workload time is unavailable/)).toBeVisible();
 expect(screen.queryByRole('combobox',{name:'Target metric'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('Recorded target values and checkpoints'));
 expect(await screen.findByRole('combobox',{name:'Target metric'})).toBeVisible();expect(f.read).toHaveBeenCalledTimes(1);
 expect(f.api.records).toHaveLength(0);
});

it('withdraws charts on failure and retries the same scoped artifact explicitly',async()=>{
 const read=vi.fn().mockRejectedValueOnce(Error('synthetic failure')).mockResolvedValue(report());const f=mount(read);
 const retry=await screen.findByRole('button',{name:'Retry target observations'});expect(screen.queryByRole('img')).not.toBeInTheDocument();
 fireEvent.click(retry);await screen.findByText(/recorded target observations/);expect(read).toHaveBeenCalledTimes(2);
 expect(read.mock.calls[1]![0].params).toEqual(fixture().params);f.unmount();
 await waitFor(()=>expect(read.mock.calls[1]![0].signal.aborted).toBe(true));
});
