// @vitest-environment jsdom
/* Emergency sheet: the texted position must say how old it is once GPS has gone stale (audit 2026-10-27). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/services/ui', () => ({ toast: vi.fn(), closePanels: vi.fn(), openCard: vi.fn(), closeCard: vi.fn(), updateCard: vi.fn(), confirmDialog: vi.fn(), uiStore: { getState: () => ({ card: null }) } }));
vi.mock('../../../src/services/native', () => ({ backgroundLocation: vi.fn(), haptic: vi.fn(), isNativeShell: () => false, nativeAnchorWatch: vi.fn(), nativeAnchorSilence: vi.fn(), saveOrShareFile: vi.fn() }));
vi.mock('../../../src/engine/app.js', () => ({ getMap: () => null, applyPendingUpdate: vi.fn() }));
vi.mock('../../../src/engine/spots.js', () => ({ escapeHtml: (s: string) => s, refreshSpotDistances: () => {} }));
vi.mock('../../../src/engine/weather.js', () => ({ compass: () => 'N' }));
vi.mock('../../../src/engine/db.js', () => ({ idb: {} }));

import { emergencySmsBody } from '../../../src/shell/panels/emergency';

describe('emergencySmsBody', () => {
  const now = Date.UTC(2026, 9, 27, 18, 0, 0);
  it('a live fix: legacy text with DMM, decimal and a map link, no age', () => {
    const b = emergencySmsBody(33.7745, -118.4239, now - 2000, now);
    expect(b).toContain("33°46.470'N 118°25.434'W");
    expect(b).toContain('(33.77450, -118.42390)');
    expect(b).toContain('https://maps.google.com/?q=33.77450,-118.42390');
    expect(b).not.toContain('last GPS fix');
  });
  it('a stale fix says when it was taken', () => {
    const b = emergencySmsBody(33.7745, -118.4239, now - 20 * 60000, now);
    expect(b).toMatch(/last GPS fix at .+ I may have moved since/);
  });
});
