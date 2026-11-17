import type { ApiClientFailure } from '@beetle/contracts/api';
import type { Config } from '../suites/draft.js';
import { seconds } from './load.js';
import { identifierPattern, isObj, list, methods, objects, text } from './model.js';

/** One thing to fix before saving; `path` is a JSON pointer into the config, or '' for the whole draft. */
export type Problem = { path: string; message: string };

/** DOM id of the control that edits `path`; jump-to falls back to the nearest parent control. */
export const fieldId = (path: string) => `suite-field${path}`;
export function jumpTo(path: string) {
  const parts = path.split('/');
  for (let length = parts.length; length > 0; length--) {
    const node = document.getElementById(fieldId(parts.slice(0, length).join('/')));
    if (node) {
      node.scrollIntoView?.({ block: 'center' });
      node.focus();
      return true;
    }
  }
  return false;
}

function whole(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
const durationPattern = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/;
const integerFields: Record<string, [number, number]> = {
  rate: [1, 1000000],
  startRate: [1, 1000000],
  maxRate: [1, 1000000],
  stepRate: [1, 1000000],
  preAllocatedVUs: [1, 100000],
  maxVUs: [1, 100000],
  vus: [1, 100000],
  startVUs: [0, 100000],
  iterations: [1, 1000000000],
};
const durationFields = [
  'startTime',
  'gracefulStop',
  'timeUnit',
  'duration',
  'maxDuration',
  'stepDuration',
  'gracefulRampDown',
];

/** Client checks for what the form edits. The server's structural preflight stays authoritative. */
export function validate(config: Config): Problem[] {
  const found: Problem[] = [];
  const add = (path: string, message: string) => found.length < 64 && found.push({ path, message });
  if (!text(config.target).trim()) add('/target', 'Target URL is required.');
  const requests = objects(config.requests);
  if (!requests.length) add('/requests', 'Add at least one request.');
  requests.forEach((request, index) => {
    const label = `Request ${index + 1}`;
    if (!text(request.name).trim()) add(`/requests/${index}/name`, `${label} needs a name.`);
    if (!methods.includes(request.method as (typeof methods)[number]))
      add(`/requests/${index}/method`, `${label} needs a method.`);
    if (!text(request.path).startsWith('/')) add(`/requests/${index}/path`, `${label} path must start with /.`);
    objects(request.assertions).forEach((check, position) => {
      if (check.kind === 'statusEq' && !whole(check.value, 100, 599))
        add(`/requests/${index}/assertions/${position}`, `${label}: status must be from 100 to 599.`);
      if ('path' in check && !text(check.path).startsWith('$'))
        add(`/requests/${index}/assertions/${position}`, `${label}: JSON path must start with $.`);
    });
  });
  objects(config.selections).forEach((selection, index) =>
    objects(selection.entries).forEach((entry, position) => {
      if (!whole(entry.weight, 1, 1000000)) {
        const request = requests.findIndex((item) => item.id === entry.requestId);
        add(
          request >= 0 && index === 0
            ? `/requests/${request}/weight`
            : `/selections/${index}/entries/${position}/weight`,
          `Weight for ${text(entry.requestId, 'a request')} must be a whole number from 1 to 1,000,000.`,
        );
      }
    }),
  );
  const plan = isObj(config.loadPlan) ? config.loadPlan : {};
  objects(plan.scenarios).forEach((scenario, index) => {
    const label = `Scenario ${index + 1}`;
    if (!identifierPattern.test(text(scenario.name)))
      add(`/loadPlan/scenarios/${index}/name`, `${label} name may use letters, digits, _ and -.`);
    for (const [key, [minimum, maximum]] of Object.entries(integerFields))
      if (key in scenario && !whole(scenario[key], minimum, maximum))
        add(`/loadPlan/scenarios/${index}/${key}`, `${label}: ${key} must be a whole number from ${minimum}.`);
    for (const key of durationFields)
      if (key in scenario && !durationPattern.test(text(scenario[key])))
        add(`/loadPlan/scenarios/${index}/${key}`, `${label}: ${key} must look like 30s, 5m or 500ms.`);
    objects(scenario.stages).forEach((stage, position) => {
      if (seconds(stage.duration) === undefined || !whole(stage.target, 0, 1000000))
        add(
          `/loadPlan/scenarios/${index}/stages/${position}`,
          `${label} stage ${position + 1} needs a duration and a target.`,
        );
    });
  });
  list(plan.slos).forEach((rule, index) => {
    if (!isObj(rule) || typeof rule.value !== 'number' || rule.value < 0)
      add(`/loadPlan/slos/${index}/value`, `Threshold ${index + 1} needs a number of 0 or more.`);
  });
  return found;
}

const codeText: Record<string, string> = {
  required: 'is required',
  type: 'has the wrong type',
  format: 'is not in the expected format',
  range: 'is out of range',
  unknown_field: 'is not a known field',
  conflict: 'conflicts with another value',
  scope: 'belongs to another workspace',
  protected: 'is protected',
};
const tail = (parts: string[], from: number) => (parts.length > from ? ` ${parts.slice(from).join(' ')}` : '');
const ordinal = (value: string | undefined) => Number(value) + 1;
type Labeler = (parts: string[], config: Config) => string;
function requestLabel(parts: string[], config: Config) {
  const request = objects(config.requests)[Number(parts[1])];
  const name = request ? ` (${text(request.method)} ${text(request.path)})` : '';
  return `Request ${ordinal(parts[1])}${name}${tail(parts, 2)}`;
}
const labelers: Record<string, Labeler> = {
  target: () => 'Target URL',
  message: () => 'What changed',
  requests: requestLabel,
  datasets: (parts) => `Dataset ${ordinal(parts[1])}${tail(parts, 2)}`,
  selections: () => 'Request mix',
  loadPlan: (parts) =>
    parts[1] === 'slos'
      ? `Threshold ${ordinal(parts[2])}`
      : parts[1] === 'scenarios'
        ? `Scenario ${ordinal(parts[2])}${tail(parts, 3)}`
        : parts.join(' '),
  readiness: (parts) => `Readiness probe${tail(parts, 1)}`,
  targetSampling: (parts) => `Target sampling${tail(parts, 1)}`,
};
const indexed = new Set(['requests', 'datasets']);
/** Human label for a config pointer, e.g. "/requests/0/path" → "Request 1 (POST /cart) path". */
export function fieldLabel(path: string, config: Config): string {
  const parts = path.split('/').slice(1);
  const head = parts[0] ?? '';
  if (!parts.length) return 'Configuration';
  if (!Object.hasOwn(labelers, head)) return parts.join(' ');
  if (indexed.has(head) && !Number.isInteger(Number(parts[1]))) return parts.join(' ');
  return labelers[head]!(parts, config);
}
/** Server field errors from a rejected save, mapped onto config pointers. */
export function serverProblems(failure: ApiClientFailure | null, config: Config): Problem[] {
  const fields = failure?.protocol?.fields ?? [];
  return fields.map((field) => {
    const path = field.path.startsWith('/config') ? field.path.slice('/config'.length) : field.path;
    return { path, message: `${fieldLabel(path, config)} ${codeText[field.code] ?? 'is invalid'}.` };
  });
}
