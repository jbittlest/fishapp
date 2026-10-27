// @vitest-environment jsdom
/* services/native: the bridge-version gate and the two version-3 commands (requestReview and the
 * shell's answer to it, shareText), plus shareText's browser path — Web Share on phones, the
 * clipboard everywhere else. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_ANSWER_MS, nativeBridgeVersion, requestReview, shareText } from '../../src/services/native';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

let post: ReturnType<typeof vi.fn<(cmd: string, extra?: Record<string, unknown>) => void>>;
function shell(version: number) {
  post = vi.fn<(cmd: string, extra?: Record<string, unknown>) => void>();
  window.FishNative = { platform: 'ios', version, post };
}

function stub(name: 'userAgent' | 'share' | 'clipboard', value: unknown) {
  Object.defineProperty(navigator, name, { configurable: true, value });
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  delete window.FishNative;
  writeText = vi.fn(async () => undefined);
  stub('clipboard', { writeText });
  stub('userAgent', DESKTOP_UA);
  stub('share', undefined);
});

afterEach(() => {
  delete window.FishNative;
  for (const k of ['userAgent', 'share', 'clipboard']) delete (navigator as unknown as Record<string, unknown>)[k];
});

describe('nativeBridgeVersion', () => {
  it('is 0 in a browser and the shell version inside the iOS app', () => {
    expect(nativeBridgeVersion()).toBe(0);
    shell(3);
    expect(nativeBridgeVersion()).toBe(3);
  });
});

describe('requestReview', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is false in a browser', async () => {
    await expect(requestReview()).resolves.toBe(false);
  });

  it('is false on a shell older than version 3, without posting a command it would drop', async () => {
    shell(2);
    await expect(requestReview()).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('is true once a version-3 shell confirms StoreKit got the request', async () => {
    shell(3);
    const asked = requestReview();
    expect(post).toHaveBeenCalledWith('requestReview', undefined);
    window.__fishNativeReviewRequested!({ requested: true });
    await expect(asked).resolves.toBe(true);
    expect(window.__fishNativeReviewRequested).toBeUndefined();
  });

  it('is false when the shell dropped it (the app was not the active scene)', async () => {
    shell(3);
    const asked = requestReview();
    window.__fishNativeReviewRequested!({ requested: false });
    await expect(asked).resolves.toBe(false);
  });

  it('is false when the shell never answers, and ignores a late answer', async () => {
    vi.useFakeTimers();
    shell(3);
    const asked = requestReview();
    const late = window.__fishNativeReviewRequested!;
    vi.advanceTimersByTime(REVIEW_ANSWER_MS);
    await expect(asked).resolves.toBe(false);
    expect(window.__fishNativeReviewRequested).toBeUndefined();
    expect(() => late({ requested: true })).not.toThrow();
  });

  it('sends one request at a time', async () => {
    shell(3);
    const first = requestReview();
    const second = requestReview();
    expect(second).toBe(first);
    expect(post).toHaveBeenCalledTimes(1);
    window.__fishNativeReviewRequested!({ requested: true });
    await expect(second).resolves.toBe(true);

    const third = requestReview();
    expect(post).toHaveBeenCalledTimes(2);
    window.__fishNativeReviewRequested!({ requested: true });
    await expect(third).resolves.toBe(true);
  });
});

describe('shareText', () => {
  it('opens the native share sheet in a version-3 shell', async () => {
    shell(3);
    await expect(shareText({ text: ' A spot ', url: 'https://example.test/s/1', title: 'Spot' })).resolves.toBe('shared');
    expect(post).toHaveBeenCalledWith('shareText', { text: 'A spot', url: 'https://example.test/s/1' });
  });

  it('copies through the native clipboard on an older shell', async () => {
    shell(2);
    await expect(shareText({ text: 'A spot', url: 'https://example.test/s/1' })).resolves.toBe('copied');
    expect(post).toHaveBeenCalledWith('copyText', { text: 'A spot https://example.test/s/1' });
    expect(post).not.toHaveBeenCalledWith('shareText', expect.anything());
  });

  it('uses Web Share on a phone browser', async () => {
    const share = vi.fn(async () => undefined);
    stub('userAgent', IPHONE_UA);
    stub('share', share);
    await expect(shareText({ text: 'A spot', url: 'https://example.test/s/1', title: 'Spot' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'A spot', url: 'https://example.test/s/1', title: 'Spot' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a closed share sheet as cancelled', async () => {
    stub('userAgent', IPHONE_UA);
    stub('share', vi.fn(async () => { throw new DOMException('closed', 'AbortError'); }));
    await expect(shareText({ text: 'A spot' })).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when Web Share is refused', async () => {
    stub('userAgent', IPHONE_UA);
    stub('share', vi.fn(async () => { throw new DOMException('no gesture', 'NotAllowedError'); }));
    await expect(shareText({ text: 'A spot', url: 'https://example.test/s/1' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('A spot https://example.test/s/1');
  });

  it('copies on a desktop browser even when Web Share exists', async () => {
    const share = vi.fn(async () => undefined);
    stub('share', share);
    await expect(shareText({ text: 'Try this app', url: 'https://example.test/' })).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('Try this app https://example.test/');
  });

  it('does not repeat a link the text already carries', async () => {
    await shareText({ text: 'See https://example.test/s/1 tonight', url: 'https://example.test/s/1' });
    expect(writeText).toHaveBeenCalledWith('See https://example.test/s/1 tonight');
    await shareText({ text: '', url: 'https://example.test/s/2' });
    expect(writeText).toHaveBeenLastCalledWith('https://example.test/s/2');
  });

  it('is cancelled when there is nothing to share or no clipboard', async () => {
    await expect(shareText({ text: '  ' })).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
    writeText.mockImplementation(async () => { throw new Error('denied'); });
    await expect(shareText({ text: 'A spot' })).resolves.toBe('cancelled');
  });
});
