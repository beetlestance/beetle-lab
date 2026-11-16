/** Only trusted generated schema trees or bounded validated JSON snapshots enter here. */
export function freezeSchema<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
  return value;
}
