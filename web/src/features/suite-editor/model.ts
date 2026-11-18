import type { Config } from '../suites/draft.js';

/** A client authoring problem, addressed by a JSON pointer into the draft. */
export type Problem = { path: string; message: string };
export type Obj = Record<string, unknown>;
export type SetConfig = (next: Config) => void;

export const isObj = (value: unknown): value is Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const objects = (value: unknown): Obj[] => list(value).filter(isObj);
export const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
export const numberText = (value: unknown) =>
  typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';

/** Whole numbers become numbers; anything else stays as typed so validation can name it. */
export function wholeOrRaw(input: string): number | string {
  return /^-?(0|[1-9][0-9]{0,15})$/.test(input) ? Number(input) : input;
}
export function numberOrRaw(input: string): number | string {
  return /^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,9})?$/.test(input) ? Number(input) : input;
}

export const identifierPattern = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** A schema identifier from free text that does not collide with `taken`. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let stem = base.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9_-]/g, '_');
  if (!/^[A-Za-z_]/.test(stem)) stem = `_${stem}`;
  stem = stem.slice(0, 56) || 'item';
  if (!used.has(stem)) return stem;
  for (let index = 2; ; index++) if (!used.has(`${stem}_${index}`)) return `${stem}_${index}`;
}

/**
 * The URL key of request `index` (routes.suitePage `request`): its identifier when
 * valid and unique, else its 1-based position. Identifiers never start with a digit.
 */
export function requestKey(config: Config, index: number): string {
  const ids = objects(config.requests).map((request) => text(request.id));
  const id = ids[index] ?? '';
  return identifierPattern.test(id) && ids.indexOf(id) === ids.lastIndexOf(id) ? id : String(index + 1);
}
/** The request a URL key names, or null when no request matches. */
export function requestIndex(config: Config, key: string | null): number | null {
  if (!key) return null;
  const requests = objects(config.requests);
  if (/^[1-9][0-9]{0,5}$/.test(key)) return Number(key) <= requests.length ? Number(key) - 1 : null;
  const index = requests.findIndex((request) => request.id === key);
  return index < 0 ? null : index;
}

export function at<T extends Obj>(items: unknown, index: number, patch: Partial<T>): Obj[] {
  return list(items).map((item, position) =>
    position === index && isObj(item) ? { ...item, ...patch } : item,
  ) as Obj[];
}
export function without(items: unknown, index: number): unknown[] {
  return list(items).filter((_, position) => position !== index);
}

export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** First scenario: the form's "How load arrives" section edits it. */
export function firstScenario(config: Config): Obj | undefined {
  return isObj(config.loadPlan) ? objects(config.loadPlan.scenarios)[0] : undefined;
}
export function setScenario(config: Config, index: number, scenario: Obj): Config {
  const plan = isObj(config.loadPlan) ? config.loadPlan : { version: 1, scenarios: [], slos: [] };
  const scenarios = [...list(plan.scenarios)];
  scenarios[index] = scenario;
  return { ...config, loadPlan: { ...plan, scenarios } };
}

/** The selection list for a scenario (request mix). */
export function selectionFor(config: Config, scenarioId: string): Obj | undefined {
  return objects(config.selections).find((selection) => selection.scenarioId === scenarioId);
}
export function weightOf(config: Config, requestId: string): unknown {
  const scenario = firstScenario(config);
  const selection = scenario ? selectionFor(config, text(scenario.id)) : undefined;
  return objects(selection?.entries).find((entry) => entry.requestId === requestId)?.weight;
}
export function setEntry(config: Config, scenarioId: string, requestId: string, patch: Obj): Config {
  const selections = [...list(config.selections)];
  let index = selections.findIndex((item) => isObj(item) && item.scenarioId === scenarioId);
  if (index < 0) {
    selections.push({ scenarioId, entries: [] });
    index = selections.length - 1;
  }
  const selection = selections[index] as Obj;
  const entries = [...list(selection.entries)];
  const position = entries.findIndex((entry) => isObj(entry) && entry.requestId === requestId);
  if (position < 0) entries.push({ requestId, weight: 1, wait: { durationMs: 0, jitterMs: 0 }, ...patch });
  else entries[position] = { ...(entries[position] as Obj), ...patch };
  selections[index] = { ...selection, entries };
  return { ...config, selections };
}

export function addRequest(config: Config): Config {
  const requests = objects(config.requests);
  const id = uniqueId(
    'request',
    requests.map((request) => text(request.id)),
  );
  const next = {
    ...config,
    requests: [
      ...list(config.requests),
      { id, name: 'New request', method: 'GET', path: '/', query: {}, headers: {}, assertions: [] },
    ],
  };
  const scenario = firstScenario(config);
  return scenario ? setEntry(next, text(scenario.id), id, {}) : next;
}
export function removeRequest(config: Config, index: number): Config {
  const removed = list(config.requests)[index];
  const id = isObj(removed) ? removed.id : undefined;
  return {
    ...config,
    requests: without(config.requests, index),
    selections: list(config.selections).map((selection) =>
      isObj(selection)
        ? { ...selection, entries: list(selection.entries).filter((entry) => !isObj(entry) || entry.requestId !== id) }
        : selection,
    ),
  };
}

export type InputChoice = { id: string; name: string; sha256: string; bytes: number; state: string };
export function inputRef(input: InputChoice) {
  return { id: input.id, sha256: input.sha256, bytes: input.bytes };
}
/** Input ids referenced by request bodies and datasets, with the field that holds each. */
export function inputReferences(config: Config): { id: string; path: string }[] {
  const found: { id: string; path: string }[] = [];
  objects(config.requests).forEach((request, index) => {
    if (isObj(request.body) && request.body.kind === 'input' && isObj(request.body.input))
      found.push({ id: text(request.body.input.id).toLowerCase(), path: `/requests/${index}/body` });
  });
  objects(config.datasets).forEach((dataset, index) => {
    if (isObj(dataset.input))
      found.push({ id: text(dataset.input.id).toLowerCase(), path: `/datasets/${index}/input` });
  });
  return found.filter((reference) => reference.id);
}

export function formatCount(value: number) {
  return value.toLocaleString('en-US');
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${formatCount(bytes)} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
