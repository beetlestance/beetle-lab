/** Shared names and descriptions for the seven supported k6 executors. */
export const executorText: Record<string, { label: string; blurb: string }> = {
  'constant-arrival-rate': {
    label: 'Constant arrival rate',
    blurb: 'Starts requests at a fixed rate, however slow the target gets.',
  },
  'ramping-arrival-rate': {
    label: 'Ramping arrival rate',
    blurb:
      'Starts requests at a rate that changes stage by stage, however slow the target gets. Best for capacity and sale-day checks.',
  },
  'ramping-vus': {
    label: 'Ramping virtual users',
    blurb: 'Changes the number of virtual users stage by stage; each sends its next request when a reply arrives.',
  },
  'constant-vus': {
    label: 'Constant virtual users',
    blurb: 'A fixed number of virtual users, each sending its next request when a reply arrives.',
  },
  'shared-iterations': {
    label: 'Shared iterations',
    blurb: 'Virtual users share a fixed number of iterations and stop when they are done.',
  },
  'per-vu-iterations': {
    label: 'Iterations per virtual user',
    blurb: 'Each virtual user runs a fixed number of iterations.',
  },
  'ramp-until': {
    label: 'Ramp until break',
    blurb: 'Raises the rate step by step until the stop rule trips or the maximum rate is reached.',
  },
};
