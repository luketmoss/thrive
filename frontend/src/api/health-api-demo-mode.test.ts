// #236 AC5 — in demo mode the health reads never touch the network.

import { describe, it, expect, vi } from 'vitest';

const sheetsGet = vi.fn();
vi.mock('./sheets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sheets')>()),
  sheetsGet: (...args: unknown[]) => sheetsGet(...args),
}));
vi.mock('./demo-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./demo-data')>()),
  isDemo: () => true,
}));

import { fetchDailyHealth, fetchBodyMeasurements, fetchDailySummary } from './health-api';

describe('health reads in demo mode', () => {
  it('serve the demo history without calling Sheets or fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const [h, b, s] = await Promise.all([fetchDailyHealth('tok'), fetchBodyMeasurements('tok'), fetchDailySummary('tok')]);
    expect(h.length).toBeGreaterThan(60);
    expect(b.length).toBeGreaterThan(60);
    expect(s.length).toBeGreaterThan(60);
    expect(sheetsGet).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
