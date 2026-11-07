/** Freeze trusted shipped JSON trees before compilation or public exposure. */
export function freezeSchema<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeSchema(child);
  return Object.freeze(value);
}
