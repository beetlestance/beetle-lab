// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {LatencyRise} from './Extras.js';
import {liveRun} from './fixtures.js';
import source from '../../../../../contracts/fixtures/api/valid/run-latency-attribution.json' with {type:'json'};
const {query}=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('./data.js',()=>({useAttribution:query}));
afterEach(cleanup);
const origin={generation:1,manifestDigest:source.manifestDigest,measurementSourceTimeMs:source.rise.startTimeMs-400000};
const props={run:liveRun({state:'finished'}),requests:[{label:'r2',name:'Checkout',method:'POST',path:'/checkout'}],explain:true,origin};
it('uses the verified marker and request alias while keeping the native observation distinct from event source time',()=>{
 query.mockReturnValue({data:source,isError:false});render(<LatencyRise {...props} />);
 expect(screen.getByText(/06:40 into recorded engine execution/).closest('p')).toHaveTextContent('mostly POST /checkout');
});
it('uses the recorded scenario clock only for the matching native sample source', () => {
  const scenarioStartedAtMs = origin.measurementSourceTimeMs + 3000;
  query.mockReturnValue({data:source,isError:false});
  const view = render(<LatencyRise {...props} origin={{ ...origin, scenarioStartedAtMs }} />);
  expect(screen.getByText(/06:37 into the recorded scenario/)).toBeVisible();
  view.rerender(<LatencyRise {...props} origin={{ ...origin, scenarioStartedAtMs, manifestDigest: 'different' }} />);
  expect(screen.getByText(/Recorded source timestamp/)).toBeVisible();
});
it('hides cached native figures after a failure and provides explicit non-overlapping retry',()=>{
 const refetch=vi.fn();query.mockReturnValue({data:source,isError:true,isFetching:false,refetch});
 render(<LatencyRise {...props} />);expect(screen.queryByText(/mostly POST/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry latency observations'}));expect(refetch).toHaveBeenCalledWith({cancelRefetch:false});
});
it('does not wait indefinitely or claim a rise for restored unfinished state',()=>{
 query.mockReturnValue({isPending:true});render(<LatencyRise {...props} run={liveRun({state:'finalizing'})} />);
 expect(screen.getByText(/unavailable for an unfinished run/)).toBeVisible();expect(screen.queryByText(/Loading latency/)).toBeNull();
});
