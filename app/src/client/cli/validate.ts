import { isAbsolute } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import { ClientError } from './errors.js';
import { readFileBounded } from './files.js';

/** The request file each mutating command reads, by the command's name. */
const schemas = {
  run: 'CreateRunRequest',
  cancel: 'CancelRunRequest',
  compare: 'RunComparisonRequest',
  export: 'CreateExportRequest',
} as const;
type Kind = keyof typeof schemas;
const invalid = (): never => {
  throw new ClientError('invalid_input', 2);
};

function flags(argv: readonly string[]): Map<string, string> {
  if (argv.length !== 5 && !(argv.length === 6 && argv.includes('--json'))) return invalid();
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index++) {
    const key = argv[index]!;
    if (key === '--json') continue;
    const value = argv[++index];
    if (!['--kind', '--request-file'].includes(key) || values.has(key) || !value || value.startsWith('--'))
      return invalid();
    values.set(key, value);
  }
  return values;
}
function parse(argv: readonly string[]): { kind: Kind; file: string } {
  const values = flags(argv);
  const kind = values.get('--kind');
  const file = values.get('--request-file');
  if (!kind || !Object.hasOwn(schemas, kind) || !file || !isAbsolute(file) || file.includes('\0')) return invalid();
  return { kind: kind as Kind, file };
}

/**
 * `validate --kind run|cancel|compare|export --request-file <path>`: checks a request file
 * against the same closed schema and 4 KiB bound the command uses, without contacting Beetle.
 * It cannot tell whether the server accepts the request (scope, revision, capacity).
 */
export async function validateRequestFile(argv: readonly string[]): Promise<object> {
  const { kind, file } = parse(argv);
  let value: unknown;
  try {
    value = JSON.parse(await readFileBounded(file, 4096));
  } catch {
    return invalid();
  }
  if (!validateApi(schemas[kind], value).ok) return invalid();
  return { valid: true, kind, schema: schemas[kind] };
}
