// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {json,mountMetrics,page,samples,testClient} from './fixtures.js';
afterEach(cleanup);
it('uses only existing catalogue data and drops old observations on refresh',async()=>{
 let observed=true;
 const drop={...page().items[0]!,ordinal:1,metric:'dropped_iterations',total:{kind:'counter' as const,sum:7}};
 const f=testClient(request=>{
  if(request.path.includes('/samples?'))return json(samples(1,1));
  return json({...page(),items:observed?[page().items[0]!,drop]:page().items,totalSeries:observed?2:1});
 });
 mountMetrics(f.client);await screen.findByText('7 dropped iterations observed in this published source.');
 await waitFor(()=>expect(f.records).toHaveLength(2));
 fireEvent.click(screen.getByText('Arrival-rate VU planning heuristic'));
 fireEvent.change(screen.getByLabelText('Desired iterations per second'),{target:{value:'10'}});
 fireEvent.change(screen.getByLabelText('Headroom (%)'),{target:{value:'40'}});
 expect(f.records).toHaveLength(2);expect(screen.queryByLabelText('Candidate VU allocation')).not.toBeInTheDocument();
 observed=false;fireEvent.click(screen.getByRole('button',{name:'Refresh metrics'}));
 await screen.findByText(/signal is not available in this displayed catalogue page/);
 expect(screen.queryByText('Dropped load')).not.toBeInTheDocument();expect(f.records.every(r=>r.method==='GET')).toBe(true);
});
