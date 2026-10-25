import type { DatabaseSync } from "node:sqlite";

/** The demo's "today". Fixed so reports and tests are reproducible. */
export const AS_OF = "2026-09-30";

const DAY_MS = 864e5;
export const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const PREFIXES = ["Harbor", "Summit", "Northgate", "Redwood", "Bluepeak", "Ironbridge", "Clearwater", "Maple"];
const SUFFIXES = ["Logistics", "Foods", "Supply", "Industries", "Medical", "Builders", "Retail", "Energy"];
const CATEGORIES = ["Packaging", "Safety", "Tools", "Cleaning", "Office"];
const ADJECTIVES = ["Heavy-duty", "Compact", "Standard", "Premium", "Eco", "Industrial", "Light", "Pro"];
const NOUNS = ["Gloves", "Tape", "Pallet Wrap", "Label Roll", "Box Cutter", "Sanitizer", "Clipboard", "Goggles"];
const REGIONS = ["Northeast", "Southeast", "Midwest", "West"];
const SEGMENTS = ["Enterprise", "Mid-Market", "SMB"] as const;
const CREDIT = { Enterprise: 250000, "Mid-Market": 90000, SMB: 25000 } as const;

export type SeedOptions = { seed?: number; asOf?: string };

/** Fills an empty ERP schema with synthetic, deterministic data. No real people or companies. */
export function seedErp(db: DatabaseSync, { seed = 42, asOf = AS_OF }: SeedOptions = {}): void {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  db.exec("BEGIN");

  const insertCustomer = db.prepare("INSERT INTO customers VALUES (?,?,?,?,?,?)");
  const customerIds: number[] = [];
  for (let i = 1; i <= 60; i++) {
    const segment = pick(SEGMENTS);
    const name = `${PREFIXES[i % PREFIXES.length]} ${SUFFIXES[Math.floor(i / PREFIXES.length) % SUFFIXES.length]} ${i}`;
    insertCustomer.run(i, name, segment, pick(REGIONS), CREDIT[segment], addDays(asOf, -int(400, 900)));
    customerIds.push(i);
  }

  const insertProduct = db.prepare("INSERT INTO products VALUES (?,?,?,?,?,?)");
  const prices = new Map<number, number>();
  for (let i = 1; i <= 40; i++) {
    const price = round2(5 + rnd() * 195);
    prices.set(i, price);
    insertProduct.run(i, `SKU-${1000 + i}`, `${pick(ADJECTIVES)} ${pick(NOUNS)} ${i}`, pick(CATEGORIES), price, round2(price * (0.55 + rnd() * 0.2)));
  }

  const insertOrder = db.prepare("INSERT INTO orders VALUES (?,?,?,?,?)");
  const insertItem = db.prepare("INSERT INTO order_items VALUES (?,?,?,?,?)");
  const insertInvoice = db.prepare("INSERT INTO invoices VALUES (?,?,?,?,?,?,?)");
  const insertPayment = db.prepare("INSERT INTO payments VALUES (?,?,?,?)");
  const insertBilling = db.prepare("INSERT INTO billing_export VALUES (?,?,?)");

  let itemId = 0;
  let invoiceId = 0;
  let paymentId = 0;
  for (let orderId = 1; orderId <= 1200; orderId++) {
    const orderDate = addDays(asOf, -int(0, 364));
    const age = daysBetween(orderDate, asOf);
    const status = rnd() < 0.06 ? "cancelled" : age < 10 && rnd() < 0.6 ? "open" : "shipped";

    const productIds = new Set<number>();
    const lines = int(1, 4);
    while (productIds.size < lines) productIds.add(int(1, 40));
    let total = 0;
    const items: [number, number, number][] = [];
    for (const productId of productIds) {
      const quantity = int(1, 40);
      const unitPrice = round2(prices.get(productId)! * (0.9 + rnd() * 0.15));
      total += quantity * unitPrice;
      items.push([productId, quantity, unitPrice]);
    }
    total = round2(total);

    const customerId = pick(customerIds);
    insertOrder.run(orderId, customerId, orderDate, status, total);
    for (const [productId, quantity, unitPrice] of items) {
      insertItem.run(++itemId, orderId, productId, quantity, unitPrice);
    }
    if (status === "cancelled") continue;

    const issue = addDays(orderDate, int(0, 3));
    const due = addDays(issue, 30);
    const overdueDays = daysBetween(due, asOf);
    // Most invoices past due have been paid; the longer overdue, the likelier it is settled.
    const paid = rnd() < (overdueDays <= 0 ? 0.3 : Math.min(0.97, 0.8 + overdueDays / 500));
    const id = ++invoiceId;
    insertInvoice.run(id, orderId, customerId, issue, due, total, paid ? "paid" : "open");

    if (paid) {
      const paidDate = addDays(issue, int(5, 35));
      insertPayment.run(++paymentId, id, paidDate > asOf ? asOf : paidDate, total);
    } else if (rnd() < 0.15) {
      insertPayment.run(++paymentId, id, asOf, round2(total * (0.3 + rnd() * 0.4)));
    }

    // Billing export mirrors the invoice, with a few deliberate, deterministic discrepancies.
    if (id % 97 === 0) continue;
    if (id % 89 === 0) insertBilling.run(id, round2(total + 12.5), paid ? "paid" : "open");
    else if (id % 83 === 0) insertBilling.run(id, total, paid ? "open" : "paid");
    else insertBilling.run(id, total, paid ? "paid" : "open");
  }
  insertBilling.run(invoiceId + 1, 480, "open");
  insertBilling.run(invoiceId + 2, 1125.75, "paid");

  const insertInventory = db.prepare("INSERT INTO inventory VALUES (?,?,?,?)");
  for (let productId = 1; productId <= 40; productId++) {
    for (const warehouse of ["East", "West"]) {
      insertInventory.run(productId, warehouse, int(0, 400), int(60, 150));
    }
  }

  const insertVendor = db.prepare("INSERT INTO vendors VALUES (?,?,?)");
  const leadTimes = new Map<number, number>();
  for (let v = 1; v <= 8; v++) {
    const lead = int(7, 35);
    leadTimes.set(v, lead);
    insertVendor.run(v, `${pick(PREFIXES)} Wholesale ${v}`, lead);
  }

  const insertPo = db.prepare("INSERT INTO purchase_orders VALUES (?,?,?,?,?,?,?)");
  for (let po = 1; po <= 60; po++) {
    const vendorId = int(1, 8);
    const ordered = addDays(asOf, -int(1, 90));
    const expected = addDays(ordered, leadTimes.get(vendorId)!);
    const received = expected <= asOf && rnd() < 0.7;
    insertPo.run(po, vendorId, int(1, 40), int(50, 500), ordered, expected, received ? "received" : "open");
  }

  db.exec("COMMIT");
}
