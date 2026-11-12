// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {DroppedLoad,RecordedLoadAdvice} from './index.js';
import {drops,duration} from './fixtures.js';
afterEach(cleanup);
it('labels current-window observations and executor alternatives without cumulative claims',()=>{
 const view=render(<DroppedLoad rows={[drops(3)]} coverage="unknown" scope="live window" />);
 expect(screen.getByText('At least 3 dropped iterations observed in this live window.')).toBeInTheDocument();
 expect(screen.getByText(/iteration-count scenarios can reach maxDuration/)).toBeInTheDocument();
 view.rerender(<DroppedLoad rows={[]} coverage="unknown" scope="live window" />);
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.getByText(/does not mean zero/)).toBeInTheDocument();
 view.rerender(<DroppedLoad rows={[drops(0)]} coverage="unknown" scope="live window" />);
 expect(screen.getByText(/0 dropped iterations recorded.*coverage is incomplete or unknown/)).toBeInTheDocument();
});
it('recalculates from current rows and coverage, retiring numeric advice when unavailable',()=>{
 const view=render(<RecordedLoadAdvice rows={[duration(),drops()]} coverage="complete" />);
 fireEvent.click(screen.getByText('Arrival-rate VU planning heuristic'));
 fireEvent.change(screen.getByLabelText('Desired iterations per second'),{target:{value:'10'}});
 expect(screen.getByLabelText('Candidate VU allocation')).toHaveTextContent('6 VUs (heuristic)');
 fireEvent.change(screen.getByLabelText('Headroom (%)'),{target:{value:'0'}});
 expect(screen.getByLabelText('Candidate VU allocation')).toHaveTextContent('5 VUs (heuristic)');
 view.rerender(<RecordedLoadAdvice rows={[duration()]} coverage="partial" />);
 expect(screen.queryByLabelText('Candidate VU allocation')).not.toBeInTheDocument();expect(screen.getByText(/needs complete/)).toBeInTheDocument();
 view.rerender(<RecordedLoadAdvice rows={[]} coverage="complete" />);
 expect(screen.queryByLabelText('Candidate VU allocation')).not.toBeInTheDocument();expect(screen.getByText(/not available in this catalogue page/)).toBeInTheDocument();
});
