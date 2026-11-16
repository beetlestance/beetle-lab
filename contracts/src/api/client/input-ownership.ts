import type { ApiOperation } from '../generated/operations.js';
import type { InputPage, InputReceipt, InputRecord } from '../generated/types.js';
import type { PreparedInput } from './input.js';

function sameUuid(left: unknown, right: unknown): boolean {
  return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
}
function validRecord(record: InputRecord): boolean {
  if (record.offset > record.bytes || record.name.trim() !== record.name || !record.name.trim()) return false;
  if (['publishing', 'published'].includes(record.state) && record.offset !== record.bytes) return false;
  if (record.state === 'failed') return record.reason !== null;
  return record.state === 'deleting' || record.reason === null;
}
function receiptMatches(operation: ApiOperation, input: PreparedInput, receipt: InputReceipt): boolean {
  const expected = operation.name === 'sealInput' ? 'seal' : 'delete';
  const version = input.body?.expectedVersion;
  return sameUuid(receipt.id, input.params.inputId) && sameUuid(receipt.requestId, input.body?.requestId)
    && receipt.operation === expected && typeof version === 'number' && receipt.acceptedVersion === version + 1;
}
function creationMatches(input: PreparedInput, record: InputRecord): boolean {
  const request = input.body!;
  return record.sha256 === request.sha256 && record.bytes === request.bytes && record.name === (request.name as string).trim()
    && (request.folderId === undefined || sameUuid(record.folderId, request.folderId))
    && record.state === 'staging' && record.offset === 0 && record.version === 1 && record.reason === null;
}
function recordMatches(operation: ApiOperation, input: PreparedInput, record: InputRecord): boolean {
  return validRecord(record) && (operation.name === 'createInput'
    ? creationMatches(input, record) : sameUuid(record.id, input.params.inputId));
}
/** Structural validation and common route/scope checks precede this binding. */
export function inputOwnership(operation: ApiOperation, input: PreparedInput, value: unknown): boolean {
  switch (operation.response) {
    case 'InputPage': return (value as InputPage).items.every(validRecord);
    case 'InputReceipt': return receiptMatches(operation, input, value as InputReceipt);
    case 'InputRecord': return recordMatches(operation, input, value as InputRecord);
    default: return true;
  }
}
