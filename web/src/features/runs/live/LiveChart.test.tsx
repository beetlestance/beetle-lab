// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { LiveChart } from './LiveChart.js';
afterEach(cleanup);
it('keeps a single measured point visible on either side of a missing interval', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000, 4000]}
      domain={[0, 5000]}
      breaks={[false, true]}
      series={[{ key: 'p95', label: 'p95', tone: 'amber', values: [25, 30] }]}
      format={String}
    />,
  );
  const lines = [...view.container.querySelectorAll('.live-line')];
  expect(lines).toHaveLength(2);
  expect(lines.every((line) => !line.getAttribute('d')?.includes(' L'))).toBe(true);
  expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(2);
});
it('connects contiguous windows without adding singleton markers', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000, 2000]}
      domain={[0, 5000]}
      breaks={[false, false]}
      series={[{ key: 'p95', label: 'p95', tone: 'amber', values: [25, 30] }]}
      format={String}
    />,
  );
  expect(view.container.querySelectorAll('.live-line')).toHaveLength(1);
  expect(view.container.querySelector('.live-line')?.getAttribute('d')).toContain(' L');
  expect(view.container.querySelectorAll('.live-single-point')).toHaveLength(0);
});

it('marks only phase annotations as detail while retaining boundaries and current time', () => {
  const view = render(
    <LiveChart
      title="Measured windows"
      xs={[1000]}
      domain={[0, 600000]}
      series={[]}
      format={String}
      ticks={[
        { at: 0, label: '00:00' },
        { at: 60000, label: 'Warm up ends 01:00', detail: true },
        { at: 316000, label: 'now 05:16' },
        { at: 600000, label: '10:00' },
      ]}
    />,
  );
  expect([...view.container.querySelectorAll('.live-tick-detail')].map((node) => node.textContent)).toEqual([
    'Warm up ends 01:00',
  ]);
  expect(
    [...view.container.querySelectorAll('.live-ticks > span:not(.live-tick-detail)')].map((node) => node.textContent),
  ).toEqual(['00:00', 'now 05:16', '10:00']);
});
