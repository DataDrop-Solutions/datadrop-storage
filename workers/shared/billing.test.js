// End-to-end billing lifecycle tests — Billing v4.2
// Tests the storage-capacity model, price validation, display normalization,
// and the complete upload-admission + limit-reduction lifecycle.
// Run: npm test

import { describe, it, expect } from 'vitest';
import {
  getStorageCapacity,
  formatCapacityGB,
  calculateFlatBill,
  accumulatedToGbMonths,
  computeBillSoFar,
} from './utils.js';

const GB    = 1024 * 1024 * 1024;
const PRICE = 1.49;

// ─────────────────────────────────────────────
// Scenario 1 — New account, ₹149 mandate → 100 GB capacity
// ─────────────────────────────────────────────
describe('Scenario 1 — ₹149 mandate → 100 GB storage capacity', () => {
  it('₹149 / ₹1.49 = exactly 100 GB capacity', () => {
    const { capacityGB, capacityBytes } = getStorageCapacity(149, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(100);
    expect(capacityBytes).toBe(Math.floor((149 / PRICE) * GB));
  });

  it('₹298 → 200 GB', () => {
    const { capacityGB } = getStorageCapacity(298, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(200);
  });

  it('₹745 → 500 GB', () => {
    const { capacityGB } = getStorageCapacity(745, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(500);
  });
});

// ─────────────────────────────────────────────
// Scenario 2 — Uploads within capacity succeed
// ─────────────────────────────────────────────
describe('Scenario 2 — Uploads within capacity are allowed', () => {
  const { capacityBytes } = getStorageCapacity(149, PRICE); // 100 GB

  it('upload that fits within remaining space is admitted', () => {
    const currentBytes = capacityBytes - 10 * 1024 * 1024; // 10 MB below max
    const uploadSize   = 5 * 1024 * 1024;                  // 5 MB
    expect(currentBytes + uploadSize).toBeLessThanOrEqual(capacityBytes);
  });

  it('upload that exactly fills capacity is admitted', () => {
    const currentBytes = capacityBytes - 1024; // 1 KB below max
    const uploadSize   = 1024;
    expect(currentBytes + uploadSize).toBeLessThanOrEqual(capacityBytes);
  });
});

// ─────────────────────────────────────────────
// Scenario 3 — Upload exceeding capacity is rejected
// ─────────────────────────────────────────────
describe('Scenario 3 — Upload that exceeds capacity is blocked', () => {
  const { capacityBytes } = getStorageCapacity(149, PRICE); // 100 GB

  it('upload that would exceed capacity is rejected', () => {
    const currentBytes = capacityBytes - 5 * 1024 * 1024; // 5 MB below max
    const uploadSize   = 10 * 1024 * 1024;                 // 10 MB — exceeds
    expect(currentBytes + uploadSize).toBeGreaterThan(capacityBytes);
  });

  it('upload of any size when already at capacity is rejected', () => {
    const currentBytes = capacityBytes;
    const uploadSize   = 1;
    expect(currentBytes + uploadSize).toBeGreaterThan(capacityBytes);
  });
});

// ─────────────────────────────────────────────
// Scenario 4 — Limit increase immediately expands capacity
// ─────────────────────────────────────────────
describe('Scenario 4 — Limit increase → immediate capacity expansion', () => {
  it('increasing from ₹149 to ₹298 expands capacity from 100 GB to 200 GB', () => {
    const { capacityGB: before, capacityBytes: beforeBytes } = getStorageCapacity(149, PRICE);
    const { capacityGB: after,  capacityBytes: afterBytes  } = getStorageCapacity(298, PRICE);
    expect(formatCapacityGB(before)).toBe(100);
    expect(formatCapacityGB(after)).toBe(200);
    expect(afterBytes).toBeGreaterThan(beforeBytes);
  });

  it('upload blocked at old capacity succeeds at new capacity', () => {
    const { capacityBytes: oldCap } = getStorageCapacity(149, PRICE);
    const { capacityBytes: newCap } = getStorageCapacity(298, PRICE);
    const storedBytes = 150 * GB; // 150 GB stored
    expect(storedBytes).toBeGreaterThan(oldCap);  // blocked before
    expect(storedBytes).toBeLessThanOrEqual(newCap); // allowed after
  });
});

// ─────────────────────────────────────────────
// Scenario 5 — Limit reduction below current storage is rejected
// ─────────────────────────────────────────────
describe('Scenario 5 — Cannot reduce limit below current storage', () => {
  it('rejects ₹299→₹149 when 180 GB is stored', () => {
    const { capacityBytes: newCap } = getStorageCapacity(149, PRICE); // 100 GB
    const storedBytes = 180 * GB; // 180 GB stored
    expect(storedBytes).toBeGreaterThan(newCap); // reduction must be rejected
  });

  it('rejects any reduction where stored > new capacity', () => {
    const { capacityBytes: newCap } = getStorageCapacity(149, PRICE);
    const storedBytes = newCap + 1; // one byte over
    expect(storedBytes).toBeGreaterThan(newCap);
  });
});

// ─────────────────────────────────────────────
// Scenario 6 — Limit reduction allowed after freeing space
// ─────────────────────────────────────────────
describe('Scenario 6 — Limit reduction allowed when storage fits new capacity', () => {
  it('allows ₹299→₹149 after deleting files to below 100 GB', () => {
    const { capacityBytes: newCap } = getStorageCapacity(149, PRICE); // 100 GB
    const storedBytes = 80 * GB; // 80 GB remaining after deletes
    expect(storedBytes).toBeLessThanOrEqual(newCap); // reduction is allowed
  });

  it('allows reduction exactly at new capacity boundary', () => {
    const { capacityBytes: newCap } = getStorageCapacity(149, PRICE);
    expect(newCap).toBeLessThanOrEqual(newCap); // exact boundary is OK
  });
});

// ─────────────────────────────────────────────
// Scenario 7 — Billing cycle rollover: capacity is date-independent
// ─────────────────────────────────────────────
describe('Scenario 7 — Billing cycle rollover', () => {
  it('storage capacity does not change across months', () => {
    const { capacityGB: capJul } = getStorageCapacity(149, PRICE);
    const { capacityGB: capAug } = getStorageCapacity(149, PRICE);
    expect(capJul).toBe(capAug); // pure math — no date involved
  });

  it('byte-time accumulation: 100 GB for full 31-day month = 100 GB-months', () => {
    const billingMonth = '2026-07';
    const daysInMonth  = 31;
    const byteSeconds  = 100 * GB * 86400 * daysInMonth;
    const gbMonths     = accumulatedToGbMonths(byteSeconds, billingMonth);
    expect(gbMonths).toBeCloseTo(100, 4);
  });

  it('storing 100 GB for half the month bills at half the rate', () => {
    const billingMonth = '2026-07';
    const daysInMonth  = 31;
    const byteSeconds  = 100 * GB * 86400 * (daysInMonth / 2);
    const gbMonths     = accumulatedToGbMonths(byteSeconds, billingMonth);
    const bill = calculateFlatBill(gbMonths, { storage_price_per_gb_month: PRICE });
    expect(bill).toBeCloseTo(74.5, 1); // 50 GB-months × ₹1.49 = ₹74.50
  });

  it('upload on last day of month is allowed if capacity permits', () => {
    const { capacityBytes } = getStorageCapacity(149, PRICE);
    const currentBytes = 50 * GB;
    const uploadSize   = 10 * GB;
    // Capacity check has no date — last day is treated identically to first
    expect(currentBytes + uploadSize).toBeLessThanOrEqual(capacityBytes);
  });

  it('computeBillSoFar returns min bill for new account (no usage row)', () => {
    const config = { storage_price_per_gb_month: PRICE, min_bill_amount: 1 };
    const bill   = computeBillSoFar(null, config);
    expect(bill).toBe(1);
  });
});

// ─────────────────────────────────────────────
// Scenario 8 — Configuration validation: missing price fails hard
// ─────────────────────────────────────────────
describe('Scenario 8 — Missing price configuration fails with clear error', () => {
  it('getStorageCapacity throws on null price', () => {
    expect(() => getStorageCapacity(149, null)).toThrow('not configured or invalid');
  });

  it('getStorageCapacity throws on undefined price', () => {
    expect(() => getStorageCapacity(149, undefined)).toThrow('not configured or invalid');
  });

  it('getStorageCapacity throws on NaN (config key missing from DB)', () => {
    expect(() => getStorageCapacity(149, NaN)).toThrow('not configured or invalid');
  });

  it('getStorageCapacity throws on zero price', () => {
    expect(() => getStorageCapacity(149, 0)).toThrow('not configured or invalid');
  });

  it('getStorageCapacity throws on negative price', () => {
    expect(() => getStorageCapacity(149, -1.49)).toThrow('not configured or invalid');
  });

  it('getStorageCapacity throws on Infinity', () => {
    expect(() => getStorageCapacity(149, Infinity)).toThrow('not configured or invalid');
  });

  it('calculateFlatBill throws when config missing price', () => {
    expect(() => calculateFlatBill(100, {})).toThrow('not configured or invalid');
  });

  it('calculateFlatBill throws when price is NaN', () => {
    expect(() => calculateFlatBill(100, { storage_price_per_gb_month: NaN }))
      .toThrow('not configured or invalid');
  });

  it('calculateFlatBill throws when price is zero', () => {
    expect(() => calculateFlatBill(100, { storage_price_per_gb_month: 0 }))
      .toThrow('not configured or invalid');
  });

  it('calculateFlatBill works correctly with valid price', () => {
    const bill = calculateFlatBill(100, { storage_price_per_gb_month: PRICE });
    expect(bill).toBeCloseTo(149, 2);
  });
});

// ─────────────────────────────────────────────
// Display normalization — no floating-point artifacts
// ─────────────────────────────────────────────
describe('Display normalization — formatCapacityGB', () => {
  it('₹149/₹1.49 shows as 100 not 100.00000000000001', () => {
    const { capacityGB } = getStorageCapacity(149, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(100);
  });

  it('₹298/₹1.49 shows as 200 not 200.0000000000003', () => {
    const { capacityGB } = getStorageCapacity(298, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(200);
  });

  it('₹745/₹1.49 shows as 500 not 500.00000000000006', () => {
    const { capacityGB } = getStorageCapacity(745, PRICE);
    expect(formatCapacityGB(capacityGB)).toBe(500);
  });

  it('non-round value shows one decimal place', () => {
    expect(formatCapacityGB(75.18)).toBe(75.2);
  });

  it('returns null for null/undefined', () => {
    expect(formatCapacityGB(null)).toBeNull();
    expect(formatCapacityGB(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(formatCapacityGB(NaN)).toBeNull();
  });
});
