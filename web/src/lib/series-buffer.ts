/** Fixed-capacity chart history. Missing observations stay missing. */
export class SeriesBuffer<T> {
  private readonly values: (T | undefined)[];
  private next = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000) {
      throw new RangeError('Chart capacity must be an integer between 1 and 100000');
    }
    this.values = new Array<T | undefined>(capacity);
  }

  push(value: T): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  snapshot(): T[] {
    const start = this.count === this.capacity ? this.next : 0;
    return Array.from({ length: this.count }, (_, offset) => this.values[(start + offset) % this.capacity] as T);
  }

  clear(): void {
    this.values.fill(undefined);
    this.next = 0;
    this.count = 0;
  }
}
