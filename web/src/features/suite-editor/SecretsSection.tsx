import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { Card, TextField } from './fields.js';
import { at, objects, text, uniqueId, without } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';

/** Only locations containing the literal reference; no provider lookup or secret value read. */
function usedBy(config: Config, name: string): string[] {
  if (!name) return [];
  const token = `{{secret.${name}}}`;
  const used: string[] = [];
  for (const request of objects(config.requests).slice(0, 64)) {
    const locations = ['path', 'query', 'headers', 'body', 'assertions'].filter((key) =>
      JSON.stringify(request[key] ?? '').includes(token),
    );
    if (locations.length) used.push(`${text(request.method)} ${text(request.path)} (${locations.join(', ')})`);
  }
  return used;
}
function SecretRow({
  config,
  secret,
  index,
  change,
  remove,
}: {
  config: Config;
  secret: Obj;
  index: number;
  change: (patch: Obj) => void;
  remove: () => void;
}) {
  const path = `/secrets/${index}`;
  const provider = text(secret.provider);
  const used = usedBy(config, text(secret.name));
  return (
    <li className="secret-entry" id={fieldId(path)} tabIndex={-1}>
      <div className="field-row secret-fields">
        <TextField
          label={`Secret ${index + 1} name`}
          path={`${path}/name`}
          value={secret.name}
          maxLength={64}
          change={(name) => change({ name })}
        />
        <Select
          id={fieldId(`${path}/provider`)}
          label={`Secret ${index + 1} comes from`}
          value={provider}
          onChange={(event) => change({ provider: event.target.value })}
        >
          {provider !== 'env' && provider !== 'mounted' && (
            <option value={provider}>{provider || 'Choose a provider'}</option>
          )}
          <option value="env">Environment variable on the agent</option>
          <option value="mounted">Mounted file on the agent</option>
        </Select>
        <TextField
          label={`Secret ${index + 1} binding reference`}
          path={`${path}/locator`}
          value={secret.locator}
          maxLength={128}
          change={(locator) => change({ locator })}
        />
        <Button variant="text" aria-label={`Remove secret ${index + 1}`} onClick={remove}>
          Remove
        </Button>
      </div>
      {secret.version !== undefined && (
        <TextField
          label={`Secret ${index + 1} binding version`}
          path={`${path}/version`}
          value={secret.version}
          maxLength={256}
          change={(version) => change({ version })}
        />
      )}
      <p className="editor-note">
        {used.length ? `Used in: ${used.join('; ')}.` : 'Not referenced by a request in this draft.'}
      </p>
    </li>
  );
}
/** Names and preconfigured binding references only. The agent remains the secret authority. */
export function SecretsSection({ config, set }: { config: Config; set: SetConfig }) {
  const secrets = objects(config.secrets);
  const add = () =>
    set({
      ...config,
      secrets: [
        ...secrets,
        {
          name: uniqueId(
            'api_token',
            secrets.map((secret) => text(secret.name)),
          ),
          provider: 'env',
          locator: '',
        },
      ],
    });
  return (
    <Card
      title="Secrets"
      action={
        <Button variant="text" disabled={secrets.length >= 64} onClick={add}>
          Add secret
        </Button>
      }
    >
      <p className="editor-note">
        The suite stores only a name and where to find the value. The agent reads it just before the run starts; it is
        never saved with the suite or shown.
      </p>
      <p className="editor-note">
        The binding reference must already be configured on the agent for this workspace. It is not a secret value or an
        arbitrary host file path.
      </p>
      <ol className="editor-list">
        {secrets.map((secret, index) => (
          <SecretRow
            key={index}
            config={config}
            secret={secret}
            index={index}
            change={(patch) => set({ ...config, secrets: at(secrets, index, patch) })}
            remove={() => set({ ...config, secrets: without(secrets, index) })}
          />
        ))}
      </ol>
      {!secrets.length && <p className="editor-note">No secret references in this draft.</p>}
    </Card>
  );
}
