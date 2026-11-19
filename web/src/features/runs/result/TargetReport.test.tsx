// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiContext } from '../../../app/api.js';
import { testClient, json, deferred } from '../../../app/test-fixtures.js';
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

it('switches between recorded phases and cards without a new artifact read', async () => {
 const f=fixture();const read=vi.fn(async()=>report());const reads={read};const api=testClient(()=>json({}));
 const draw=(phaseView:boolean)=><ApiContext.Provider value={api.client}><ResultTargetReport params={f.params} artifact={f.artifact} nativeOrigin={null} hover={{hoverT:null,onHover:vi.fn()}} reads={reads} phaseView={phaseView}/></ApiContext.Provider>;
 const view=render(draw(false));await screen.findByText(/recorded target observations/);
 view.rerender(draw(true));expect(await screen.findByRole('region',{name:'Target by recorded phase'})).toBeVisible();
 expect(screen.getAllByRole('img')).toHaveLength(1);
 const longest=screen.getByRole('rowheader',{name:'Longest GC pause'}).closest('tr')!;
 expect(within(longest).getAllByRole('cell').map(cell=>cell.textContent)).toEqual(['—','—','—','—']);
 expect(screen.queryByLabelText('Recorded HTTP landmarks')).not.toBeInTheDocument();
 view.rerender(draw(false));expect(await screen.findAllByRole('img')).toHaveLength(4);expect(read).toHaveBeenCalledTimes(1);
 expect(api.records).toHaveLength(0);
});

it('reloads through the same report owner and hides accepted charts after a failed reload', async () => {
 const read=vi.fn().mockResolvedValueOnce(report()).mockRejectedValueOnce(Error('synthetic reload failure'));
 const f=mount(read);await screen.findByText(/recorded target observations/);
 fireEvent.click(screen.getByText('Recorded target values and checkpoints'));
 const details=screen.getByText('Recorded target values and checkpoints').closest('details')!;
 details.open=true;fireEvent(details,new Event('toggle'));
 fireEvent.click(await screen.findByRole('button',{name:'Reload target report'}));
 expect(await screen.findByRole('button',{name:'Retry target observations'})).toBeVisible();
 expect(screen.queryAllByRole('img')).toHaveLength(0);expect(f.read).toHaveBeenCalledTimes(2);
 expect(read).toHaveBeenNthCalledWith(2,expect.objectContaining({params:fixture().params}));
});

it('keeps advanced values expanded across a successful explicit reload', async () => {
 const next=deferred<ReturnType<typeof report>>();
 const read=vi.fn().mockResolvedValueOnce(report()).mockImplementationOnce(()=>next.promise);
 const f=mount(read);await screen.findByText(/recorded target observations/);
 const details=screen.getByText('Recorded target values and checkpoints').closest('details')!;
 details.open=true;fireEvent(details,new Event('toggle'));
 expect(await screen.findByRole('combobox',{name:'Target metric'})).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Reload target report'}));
 expect(await screen.findByText('Reading verified target observations…')).toBeVisible();
 expect(screen.queryAllByRole('img')).toHaveLength(0);
 next.resolve(report());
 expect(await screen.findByRole('combobox',{name:'Target metric'})).toBeVisible();
 expect(screen.getByText('Recorded target values and checkpoints').closest('details')).toHaveAttribute('open');
 expect(f.read).toHaveBeenCalledTimes(2);
});
