import type { DatabaseSync } from 'node:sqlite';
import { SemanticError } from '../../../domain/namespaces/index.js';
import { Entities } from './entities.js';
import { Namespaces } from './namespaces.js';
import { Reads } from './reads.js';
import { Settings } from './settings.js';
import { transaction } from './schema.js';
import { boundedCopy, lower, scopeKey } from './input.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, ErrorCode, Operation, Value } from './protocol.js';

export function safeCode(error: unknown): ErrorCode {
  if (error instanceof StorageError || error instanceof SemanticError) return error.code;
  if (typeof error === 'object' && error !== null && 'errcode' in error) {
    if (error.errcode === 5 || error.errcode === 6) return 'owned';
    if (typeof error.errcode === 'number' && (error.errcode & 255) === 19) return 'conflict';
  }
  return 'unavailable';
}
export class Store {
  private readonly entities: Entities;
  private readonly namespaces: Namespaces;
  private readonly settings: Settings;
  private readonly reads: Reads;
  constructor(private readonly db: DatabaseSync, bootstrap: Bootstrap) {
    this.entities = new Entities(db);
    this.settings = transaction(db, () => new Settings(db, bootstrap));
    this.namespaces = new Namespaces(db, this.entities, this.settings);
    this.reads = new Reads(db, this.entities);
  }
  private mutation(operation: Extract<Operation, { kind: 'namespace' | 'settings' }>): Value {
    const command = operation.command;
    return transaction(this.db, () => {
      const scope = scopeKey(command.request.scope);
      const requestId = lower(command.request.requestId);
      const receipt = this.db.prepare('SELECT digest,result_json FROM receipts WHERE scope_key=? AND request_id=?')
        .get(scope, requestId);
      if (receipt) {
        if (receipt.digest !== command.intentDigest) throw new StorageError('conflict');
        if (typeof receipt.result_json !== 'string') throw new StorageError('unavailable');
        return JSON.parse(receipt.result_json) as Value;
      }
      const value = operation.kind === 'namespace' ? this.namespaces.change(operation.command) :
        this.settings.change(operation.command);
      const copy = boundedCopy(value);
      this.db.prepare('INSERT INTO receipts(scope_key,request_id,digest,result_json) VALUES (?,?,?,?)')
        .run(scope, requestId, command.intentDigest, JSON.stringify(copy));
      return copy;
    });
  }
  execute(operation: Operation): Value {
    switch (operation.kind) {
      case 'namespace': case 'settings': return this.mutation(operation);
      case 'get': return this.entities.get(operation.key);
      case 'list': return this.reads.list(operation.query);
      case 'getSettings': return this.settings.get(operation.scope);
      case 'runtime': return this.settings.updateRuntime(operation.runtime);
      case 'close': this.db.close(); return null;
    }
  }
}
