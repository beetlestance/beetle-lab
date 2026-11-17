/**
 * Three fixed sample inputs, generated in the browser and uploaded through the
 * normal input workflow. Content is deterministic so the same sample always has
 * the same hash; no backend sample catalogue exists.
 */
export type SampleId = 'users' | 'product-ids' | 'order-body';
export interface Sample {
  readonly id: SampleId;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly rows: number;
  readonly columns: number;
  readonly content: () => string;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

function users(): string {
  const lines = ['id,username,email,password'];
  for (let index = 1; index <= 100; index++) {
    const id = pad(index, 3);
    lines.push(`${index},user${id},user${id}@example.test,sample-password-${id}`);
  }
  return `${lines.join('\n')}\n`;
}

function productIds(): string {
  const lines = ['product_id'];
  for (let index = 1; index <= 500; index++) lines.push(`SKU-${pad(index, 5)}`);
  return `${lines.join('\n')}\n`;
}

function orderBody(): string {
  const orders = Array.from({ length: 20 }, (_, index) => ({
    orderId: `order-${pad(index + 1, 3)}`,
    productId: `SKU-${pad(((index * 37) % 500) + 1, 5)}`,
    quantity: (index % 4) + 1,
    currency: 'EUR',
  }));
  return `${JSON.stringify(orders, null, 2)}\n`;
}

export const samples: readonly Sample[] = [
  {
    id: 'users',
    name: 'users.csv',
    title: 'Test users',
    description: 'Usernames, emails and passwords for login flows. One row per virtual user.',
    rows: 100,
    columns: 4,
    content: users,
  },
  {
    id: 'product-ids',
    name: 'product-ids.csv',
    title: 'Product IDs',
    description: 'One product ID per row, for catalogue and product-page requests.',
    rows: 500,
    columns: 1,
    content: productIds,
  },
  {
    id: 'order-body',
    name: 'order-body.json',
    title: 'Order request bodies',
    description: 'A JSON array of order objects to send as POST bodies.',
    rows: 20,
    columns: 4,
    content: orderBody,
  },
];

/** First free "name-2.ext", "name-3.ext" among the listed names. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let index = 2; index < 1000; index++) {
    const candidate = `${stem}-${index}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
}
