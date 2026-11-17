import { nativeOutcome } from '../../qualification/native-application/compose/outcome.js';
import { object } from './descriptors.js';
/** A diagnostic never grants image or installation qualification. */
export function nativeFailureRecord(value: unknown) {
  const outcome = object(value);
  if (outcome.format !== 'beetle-native-outcome' || outcome.version !== 1) throw Error('Native outcome unavailable');
  return { format: 'beetle-pulled-native-failure', version: 1, outcome: nativeOutcome(outcome) };
}
