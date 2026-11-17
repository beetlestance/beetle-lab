import { Badge } from '../../components/Badge.js';

/**
 * Planned engines: fixed product copy from the Penpot board, labelled as planned.
 * The bars are illustrative samples, not data, and say so in their caption.
 */
interface Planned {
  name: string;
  runs: string;
  passOrFail: string;
  resultShows: string;
  /** Sample bar segments: pass, fail and skipped shares that add up to 1. */
  bar: readonly [number, number, number];
  sample: string;
}

const planned: readonly Planned[] = [
  {
    name: 'Unit tests',
    runs: 'Vitest, Jest or pytest suites inside a pinned container.',
    passOrFail: 'Every test passes, with an optional coverage floor.',
    resultShows: 'Passed, failed and skipped tests, slowest tests, coverage.',
    bar: [412 / 424, 3 / 424, 9 / 424],
    sample: 'Sample: 412 passed, 3 failed, 9 skipped',
  },
  {
    name: 'Integration tests',
    runs: 'Tests against real dependencies started from a compose file.',
    passOrFail: 'Every scenario passes within its time limit.',
    resultShows: 'Scenarios, service logs, timings per step.',
    bar: [58 / 60, 0, 2 / 60],
    sample: 'Sample: 58 passed, 2 skipped',
  },
  {
    name: 'Lint checks',
    runs: 'ESLint, Ruff or golangci-lint on a revision of the code.',
    passOrFail: 'No errors, and warnings under a limit.',
    resultShows: 'Problems grouped by rule and file, new versus existing.',
    bar: [0.966, 0.006, 0.028],
    sample: 'Sample: 7 errors and 31 warnings in 1,242 files',
  },
  {
    name: 'Formatting',
    runs: 'Prettier, Black or gofmt in check mode.',
    passOrFail: 'No file would change.',
    resultShows: 'Files that would change, with the diff.',
    bar: [0.99, 0.01, 0],
    sample: 'Sample: 4 of 1,242 files would change',
  },
  {
    name: 'Mutation testing',
    runs: 'Stryker or mutmut change the code and check that the tests notice.',
    passOrFail: 'Mutation score above a floor.',
    resultShows: 'Score, surviving mutants by file, untested lines.',
    bar: [0.781, 0.219, 0],
    sample: 'Sample: Score 78%: 781 of 1,000 mutants killed',
  },
];

export function EngineFacts({ runs, passOrFail, resultShows }: Pick<Planned, 'runs' | 'passOrFail' | 'resultShows'>) {
  return (
    <dl className="engine-facts">
      <dt>Runs</dt>
      <dd>{runs}</dd>
      <dt>Pass or fail</dt>
      <dd>{passOrFail}</dd>
      <dt>Result shows</dt>
      <dd>{resultShows}</dd>
    </dl>
  );
}

export function PlannedEngines() {
  return (
    <section aria-labelledby="engines-planned" className="engines-section">
      <div className="engines-section-head">
        <h2 id="engines-planned">Planned</h2>
        <p>The bar on each card is a sample of what its runs would report.</p>
      </div>
      <ul className="engine-cards engine-cards-planned">
        {planned.map((engine) => (
          <li key={engine.name} className="engine-card engine-card-planned">
            <div className="engine-card-head">
              <h3>{engine.name}</h3>
              <Badge>Planned</Badge>
            </div>
            <EngineFacts {...engine} />
            <div className="engine-sample" aria-hidden="true">
              {engine.bar.map((share, index) =>
                share > 0 ? (
                  <span key={index} className={`engine-sample-${index}`} style={{ flexGrow: share }} />
                ) : null,
              )}
            </div>
            <p className="engine-sample-caption">{engine.sample}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
