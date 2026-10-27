// @vitest-environment node
/* proxy/first-mate-worker.js — launch hardening: per-client rate limits (Cloudflare binding,
   or the in-isolate fallback when the Worker was pasted without one), daily neuron budgets for
   each client and for the whole relay (a Durable Object, or an in-isolate ledger), a cap on the
   total input forwarded to the model, request-size and shape checks before anything reaches
   Workers AI, and Workers AI failures reported as a bare 503 ai_unavailable with no internal
   detail. The origin lock itself is covered in tests/unit/assistant/worker.test.js; the basics
   are re-checked here alongside the new paths (configurable origins, readable refusals).
   The fallback limiter and ledger live in module memory, so every test uses its own client IP,
   the default env() lifts the daily budgets out of the way, and the budget tests each run on a
   day of their own. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import worker, { FirstMateBudget } from '../../proxy/first-mate-worker.js';
import { SITE as SITE_CONFIG } from '../../src/services/site';

const BASE = 'https://first-mate.example.workers.dev/';
const SITE = 'https://jbittlest.github.io';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const HI = { messages: [{ role: 'user', content: 'hi' }] };
const TOML = readFileSync(new URL('../../proxy/wrangler.toml', import.meta.url), 'utf8');

let ipSeq = 0;
const freshIp = () => '198.51.100.' + (++ipSeq);

function req({ origin = SITE, method = 'POST', body = HI, raw, path = '', ip, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin != null) h.Origin = origin;
  if (ip !== null) h['CF-Connecting-IP'] = ip || freshIp();
  const init = { method, headers: h };
  if (method === 'POST') init.body = raw !== undefined ? raw : JSON.stringify(body);
  return new Request(BASE + path, init);
}
const BIG = { DAILY_NEURON_BUDGET: '1000000000', CLIENT_DAILY_NEURONS: '1000000000' };
const env = (extra = {}) => ({ ...BIG, AI: { run: vi.fn(async () => ({ response: ' ahoy ' })) }, ...extra });
const call = (opts, e = env()) => worker.fetch(req(opts), e);
// What a browser does with a CORS response: it lets the page read it only if the origin matches.
const readable = (r, origin) => [origin, '*'].includes(r.headers.get('Access-Control-Allow-Origin'));

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('origins, methods, CORS', () => {
  it.each([SITE, 'fishapp://app'])('%s gets an answer and its origin echoed', async (origin) => {
    const r = await call({ origin });
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });
  it('a request with no Origin header (not a browser) is let through', async () => {
    expect((await call({ origin: null })).status).toBe(200);
  });
  it.each(['null', 'https://evil.example', 'fishapp://other', 'https://jbittlest.github.io.evil.example'])('refuses %s before touching the AI, readably', async (origin) => {
    const e = env();
    // The preflight passes, so the browser sends the POST and the app sees the refusal as a 403 —
    // it used to fail the preflight, which reads as "no connection" and was retried every question.
    const pre = await call({ origin, method: 'OPTIONS' }, e);
    expect(pre.status).toBe(200);
    expect(readable(pre, origin)).toBe(true);
    const r = await call({ origin }, e);
    expect(r.status).toBe(403);
    expect(readable(r, origin)).toBe(true);
    expect(r.headers.get('Vary')).toBe('Origin');
    expect(await r.json()).toEqual({ error: 'forbidden' });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('a refused origin never reaches the rate limiter or the budget', async () => {
    const CHAT_LIMITER = { limit: vi.fn(async () => ({ success: true })) };
    const BUDGET = { idFromName: vi.fn(), get: vi.fn() };
    const r = await call({ origin: 'https://evil.example' }, env({ CHAT_LIMITER, BUDGET }));
    expect(r.status).toBe(403);
    expect(CHAT_LIMITER.limit).not.toHaveBeenCalled();
    expect(BUDGET.get).not.toHaveBeenCalled();
  });
  it('OPTIONS answers the preflight, exposes Retry-After, and is never rate limited', async () => {
    const ip = freshIp();
    for (let i = 0; i < 30; i++) {
      const r = await call({ method: 'OPTIONS', ip });
      expect(r.status).toBe(200);
      expect(r.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
      expect(r.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
      expect(r.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    }
    expect((await call({ ip })).status).toBe(200);
  });
  it.each(['GET', 'PUT', 'DELETE'])('%s → 405', async (method) => {
    const e = env();
    const r = await call({ method }, e);
    expect(r.status).toBe(405);
    expect(await r.json()).toEqual({ error: 'post_only' });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
});

describe('allowed origins come from ALLOWED_ORIGINS (wrangler.toml), the built-in list only as a fallback', () => {
  it('a configured list replaces the built-in one (a custom domain, say)', async () => {
    const e = env({ ALLOWED_ORIGINS: ' https://FishApp.example/ ,fishapp://app' });
    expect((await call({ origin: 'https://fishapp.example' }, e)).status).toBe(200);
    expect((await call({ origin: 'fishapp://app' }, e)).status).toBe(200);
    expect((await call({ origin: SITE }, e)).status).toBe(403);
  });
  it('`null` is refused even when someone configures it', async () => {
    const e = env({ ALLOWED_ORIGINS: 'null,' + SITE });
    expect((await call({ origin: 'null' }, e)).status).toBe(403);
    expect((await call({ origin: SITE }, e)).status).toBe(200);
  });
  it('an empty setting falls back to the built-in list instead of refusing everyone', async () => {
    expect((await call({ origin: SITE }, env({ ALLOWED_ORIGINS: '' }))).status).toBe(200);
  });
  it('the web app origin in src/site.config.json is allowed by wrangler.toml and by the built-in fallback', async () => {
    // A rename or custom domain (siteUrl) fails here until the relay allows the new origin too.
    const siteOrigin = new URL(SITE_CONFIG.siteUrl).origin;
    const m = TOML.match(/^ALLOWED_ORIGINS = "([^"]*)"/m);
    expect(m).not.toBeNull();
    const configured = m[1].split(',').map((s) => s.trim());
    expect(configured).toContain(siteOrigin);
    expect(configured).toContain('fishapp://app');
    expect((await call({ origin: siteOrigin }, env({ ALLOWED_ORIGINS: m[1] }))).status).toBe(200);
    expect((await call({ origin: siteOrigin }, env())).status).toBe(200);      // no variable: the pasted-Worker fallback
    expect((await call({ origin: 'fishapp://app' }, env())).status).toBe(200);
  });
});

describe('input validation', () => {
  it.each([
    ['not JSON', 'hello there', 'bad_json'],
    ['an empty body', '', 'bad_json'],
    ['a JSON array', '[1,2]', 'bad_request'],
    ['a JSON string', '"hi"', 'bad_request'],
    ['JSON null', 'null', 'bad_request'],
    ['messages that is not an array', JSON.stringify({ messages: 'hi' }), 'bad_request'],
    ['a system prompt that is not a string', JSON.stringify({ system: { a: 1 }, ...HI }), 'bad_request'],
    ['no user message', JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] }), 'no_user_message'],
    ['only junk messages', JSON.stringify({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 5 }] }), 'no_user_message'],
  ])('chat: %s → 400 JSON', async (_, raw, code) => {
    const e = env();
    const r = await call({ raw }, e);
    expect(r.status).toBe(400);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    expect(await r.json()).toEqual({ error: code });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it.each([
    ['no text', {}, 'no_text'],
    ['blank text', { text: '   ' }, 'no_text'],
    ['text that is not a string', { text: 42 }, 'bad_request'],
  ])('/tts: %s → 400 JSON', async (_, body, code) => {
    const e = env();
    const r = await call({ path: 'tts', body }, e);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: code });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('a body over 64 KB is refused with 413 and never parsed', async () => {
    const e = env();
    const big = JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(70 * 1024) }] });
    const r = await call({ raw: big }, e);
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: 'too_large' });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('a chunked body is counted as it streams and dropped at the cap', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    let pulled = 0;
    const stream = new ReadableStream({ pull(c) { pulled++; if (pulled > 100) c.close(); else c.enqueue(chunk); } });
    const r = await worker.fetch(new Request(BASE, {
      method: 'POST', body: stream, duplex: 'half',
      headers: { Origin: SITE, 'CF-Connecting-IP': freshIp(), 'content-type': 'application/json' },
    }), env());
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThan(10);                    // stopped reading, didn't drain 1.6 MB
  });
  it('a declared Content-Length over the cap is refused without reading the body', async () => {
    const getReader = vi.fn();
    const fake = {
      method: 'POST', url: BASE,
      headers: new Headers({ Origin: SITE, 'CF-Connecting-IP': freshIp(), 'content-length': String(65 * 1024) }),
      body: { getReader },
    };
    const r = await worker.fetch(/** @type {any} */ (fake), env());
    expect(r.status).toBe(413);
    expect(getReader).not.toHaveBeenCalled();
  });
  it('a body right at the cap is still accepted', async () => {
    const pad = 64 * 1024 - JSON.stringify({ messages: [{ role: 'user', content: '' }] }).length;
    const raw = JSON.stringify({ messages: [{ role: 'user', content: 'y'.repeat(pad) }] });
    expect(new TextEncoder().encode(raw).length).toBe(64 * 1024);
    expect((await call({ raw })).status).toBe(200);
  });
});

describe('what reaches the model is capped in total, not per message', () => {
  const sent = (e) => e.AI.run.mock.calls[0][1].messages;
  it('a typical history passes whole: system 8000 chars, the last 12 messages, 4000 chars each', async () => {
    const e = env();
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
    messages.push({ role: 'user', content: 'q'.repeat(5000) });
    await call({ body: { system: 's'.repeat(9000), messages } }, e);
    expect(sent(e)[0]).toEqual({ role: 'system', content: 's'.repeat(8000) });
    expect(sent(e)).toHaveLength(13);
    expect(sent(e).at(-1)).toEqual({ role: 'user', content: 'q'.repeat(4000) });
  });
  it('the most a client can send (8000 + 12 × 4000 characters) is cut to 4000 estimated tokens: newest kept, oldest dropped', async () => {
    const e = env();
    const messages = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: String.fromCharCode(97 + i).repeat(4000) }));
    await call({ body: { system: 's'.repeat(8000), messages } }, e);
    // 8000 ASCII = 2000 tokens of system, leaving 2000: the question and the reply before it, 1000 each.
    expect(sent(e).map((m) => m.content[0] + m.content.length)).toEqual(['s8000', 'k4000', 'l4000']);
    expect(sent(e).at(-1).role).toBe('user');
  });
  it('non-Latin text counts a token a character: a long CJK question is cut to the room left', async () => {
    const e = env();
    const q = '鱼'.repeat(3500);
    await call({ body: { system: 's'.repeat(8000), messages: [{ role: 'assistant', content: 'earlier' }, { role: 'user', content: q }] } }, e);
    expect(sent(e)).toHaveLength(2);                    // no room left for the earlier reply
    expect(sent(e)[1]).toEqual({ role: 'user', content: '鱼'.repeat(2000) });
  });
  it('a CJK system prompt is held to 3000 tokens so the question always has room', async () => {
    const e = env();
    await call({ body: { system: '海'.repeat(8000), messages: [{ role: 'user', content: 'tides?' }] } }, e);
    expect(sent(e)[0].content).toBe('海'.repeat(3000));
    expect(sent(e)[1]).toEqual({ role: 'user', content: 'tides?' });
  });
  it('a cut never splits an emoji (surrogate pair)', async () => {
    const e = env();
    await call({ body: { system: 's'.repeat(8000), messages: [{ role: 'user', content: 'a' + '🐟'.repeat(1500) }] } }, e);
    const c = sent(e)[1].content;
    expect(c).toBe('a' + '🐟'.repeat(999));           // 1 + 999 × 2 = 1999 of the 2000 tokens left
    expect(/[\ud800-\udbff]$/.test(c)).toBe(false);
  });
});

describe('rate limiting', () => {
  it('fallback limiter: 10 chats a minute per IP, then 429 with retryAfter, Retry-After and CORS', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 26, 12, 0, 0));
    const e = env();
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await call({ ip, origin: 'fishapp://app' }, e)).status).toBe(200);
    vi.setSystemTime(Date.UTC(2026, 9, 26, 12, 0, 15));
    const r = await call({ ip, origin: 'fishapp://app' }, e);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'rate_limited', retryAfter: 45 });
    expect(r.headers.get('Retry-After')).toBe('45');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('fishapp://app');
    expect(r.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
    expect(e.AI.run).toHaveBeenCalledTimes(10);

    expect((await call({ origin: 'fishapp://app' }, e)).status).toBe(200);          // another client is unaffected
    expect((await call({ ip, path: 'tts', body: { text: 'hi' } }, env({ AI: { run: async () => ({ audio: btoa('ID3') }) } }))).status).toBe(200);   // /tts has its own bucket

    vi.setSystemTime(Date.UTC(2026, 9, 26, 12, 1, 0));
    expect((await call({ ip }, e)).status).toBe(200);                                 // the window reopened
  });
  it('a rate-limited request is answered before its body is read or the AI is called', async () => {
    const e = env();
    const ip = freshIp();
    for (let i = 0; i < 10; i++) await call({ ip, raw: '{}' }, e);                    // bad requests still count
    const r = await call({ ip }, e);
    expect(r.status).toBe(429);
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('/tts allows 20 a minute per IP', async () => {
    const e = env({ AI: { run: vi.fn(async () => ({ audio: btoa('ID3') })) } });
    const ip = freshIp();
    for (let i = 0; i < 20; i++) expect((await call({ ip, path: 'tts', body: { text: 'hi' } }, e)).status).toBe(200);
    expect((await call({ ip, path: 'tts/', body: { text: 'hi' } }, e)).status).toBe(429);
  });
  it('an IPv6 client is limited by its /64, however it writes the address', async () => {
    const e = env();
    const ips = ['2001:db8:a:b::1', '2001:0db8:000a:000b:ffff::2', '2001:DB8:A:B:1:2:3:4'];
    for (let i = 0; i < 10; i++) expect((await call({ ip: ips[i % 3] }, e)).status).toBe(200);
    expect((await call({ ip: '2001:db8:a:b::99' }, e)).status).toBe(429);
    expect((await call({ ip: '2001:db8:a:c::1' }, e)).status).toBe(200);              // the next /64 is someone else
  });
  it('uses the Cloudflare binding when present, keyed by route and client', async () => {
    const CHAT_LIMITER = { limit: vi.fn(async () => ({ success: true })) };
    const e = env({ CHAT_LIMITER });
    const ip = freshIp();
    for (let i = 0; i < 15; i++) expect((await call({ ip }, e)).status).toBe(200);    // the binding decides, not the fallback
    expect(CHAT_LIMITER.limit).toHaveBeenCalledWith({ key: 'chat:' + ip });
    CHAT_LIMITER.limit.mockResolvedValueOnce({ success: false });
    const r = await call({ ip }, e);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'rate_limited', retryAfter: 60 });
    expect(r.headers.get('Retry-After')).toBe('60');
  });
  it('/tts goes through its own binding', async () => {
    const TTS_LIMITER = { limit: vi.fn(async () => ({ success: false })) };
    const CHAT_LIMITER = { limit: vi.fn(async () => ({ success: true })) };
    const e = env({ TTS_LIMITER, CHAT_LIMITER });
    const ip = freshIp();
    expect((await call({ ip, path: 'tts', body: { text: 'hi' } }, e)).status).toBe(429);
    expect(TTS_LIMITER.limit).toHaveBeenCalledWith({ key: 'tts:' + ip });
    expect(CHAT_LIMITER.limit).not.toHaveBeenCalled();
  });
  it('a binding that throws falls back to the in-isolate limiter instead of letting everything through', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = env({ CHAT_LIMITER: { limit: vi.fn(async () => { throw new Error('binding gone'); }) } });
    const ip = freshIp();
    for (let i = 0; i < 10; i++) expect((await call({ ip }, e)).status).toBe(200);
    expect((await call({ ip }, e)).status).toBe(429);
  });
});

/* ---- daily budgets ---- */
let daySeq = 0;
// A UTC day no other test has used (the fallback ledger is module state), at 18:00.
function freshDay() {
  vi.useFakeTimers({ toFake: ['Date'] });
  const t = Date.UTC(2031, 0, 1 + 10 * (++daySeq), 18, 0, 0);    // tests may move on a day themselves
  vi.setSystemTime(t);
  return t;
}
const TO_MIDNIGHT = 6 * 3600;
const ALWAYS = () => ({ CHAT_LIMITER: { limit: async () => ({ success: true }) }, TTS_LIMITER: { limit: async () => ({ success: true }) } });
// A small reservation: 'hi' is 1 token in, plus all 512 tokens out → ceil(0.027 + 104.86) = 105 neurons.
const SMALL = 105;
const WORST = { system: 's'.repeat(8000), messages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', content: 'x'.repeat(4000) })) };
// ceil(4000 × 0.026668 + 512 × 0.204805) = 212 neurons.
const WORST_COST = 212;

/* A Durable Object namespace around the real FirstMateBudget class, with an in-memory storage
   that has the KV API's shape and a blockConcurrencyWhile that really serialises. */
function budgetObject() {
  const data = new Map();
  const storage = {
    get: vi.fn(async (k) => {
      if (!Array.isArray(k)) return data.get(k);
      const m = new Map();
      for (const x of k) if (data.has(x)) m.set(x, data.get(x));
      return m;
    }),
    put: vi.fn(async (o) => { for (const [k, v] of Object.entries(o)) data.set(k, v); }),
    deleteAll: vi.fn(async () => { data.clear(); }),
  };
  let chain = Promise.resolve();
  const state = {
    storage,
    blockConcurrencyWhile: vi.fn((fn) => { const p = chain.then(() => fn()); chain = p.catch(() => {}); return p; }),
  };
  const object = new FirstMateBudget(state);
  const stub = { fetch: vi.fn((url, init) => object.fetch(new Request(url, init))) };
  const BUDGET = { idFromName: vi.fn((n) => 'id:' + n), get: vi.fn(() => stub) };
  return { BUDGET, data, storage, state, stub };
}

describe('daily budgets (in-isolate ledger, for a Worker without the BUDGET binding)', () => {
  it('one client past CLIENT_DAILY_NEURONS → 429 daily_limit until 00:00 UTC; others carry on', async () => {
    freshDay();
    const e = env({ ...ALWAYS(), CLIENT_DAILY_NEURONS: String(3 * SMALL) });
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await call({ ip }, e)).status).toBe(200);
    const r = await call({ ip, origin: 'fishapp://app' }, e);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'daily_limit', retryAfter: TO_MIDNIGHT });
    expect(r.headers.get('Retry-After')).toBe(String(TO_MIDNIGHT));
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('fishapp://app');
    expect(e.AI.run).toHaveBeenCalledTimes(3);
    expect((await call({}, e)).status).toBe(200);                                     // a different client
    vi.setSystemTime(Date.now() + TO_MIDNIGHT * 1000);
    expect((await call({ ip }, e)).status).toBe(200);                                 // a new UTC day
  });
  it('the whole relay past DAILY_NEURON_BUDGET → 503 ai_unavailable for everyone until 00:00 UTC, logged once', async () => {
    freshDay();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = env({ ...ALWAYS(), DAILY_NEURON_BUDGET: String(2 * SMALL) });
    expect((await call({}, e)).status).toBe(200);
    expect((await call({}, e)).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const r = await call({}, e);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: 'ai_unavailable', retryAfter: TO_MIDNIGHT });
      expect(r.headers.get('Retry-After')).toBe(String(TO_MIDNIGHT));
    }
    expect(e.AI.run).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/daily budget spent/);
  });
  it('the defaults are the free allowance for the relay and 2,500 neurons a client', async () => {
    freshDay();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = { ...ALWAYS(), AI: { run: vi.fn(async () => ({ response: 'ok' })) } };
    let ok = 0;
    for (const ip = freshIp(); (await call({ ip }, e)).status === 200;) ok++;
    expect(ok).toBe(Math.floor(2500 / SMALL));                                         // 23
    let all = ok;
    for (let n = 0; n < 200 && (await call({}, e)).status === 200; n++) all++;
    expect(all).toBe(Math.floor(10000 / SMALL));                                      // 95, then 503
  });
  it('the finding: a no-Origin script sending the largest request every 6 s gets 11, not 14,400 a day', async () => {
    const t0 = freshDay() - 17 * 3600 * 1000;                                        // 01:00 UTC
    vi.setSystemTime(t0);
    const e = { AI: { run: vi.fn(async () => ({ response: 'ok' })) } };              // pure defaults, fallback limiter
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 40; i++) {
      vi.setSystemTime(t0 + i * 6000);
      statuses.push((await call({ ip, origin: null, body: WORST }, e)).status);
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(Math.floor(2500 / WORST_COST));   // 11 × 212 = 2,332 neurons
    expect(statuses.slice(11).every((s) => s === 429)).toBe(true);
    expect(e.AI.run).toHaveBeenCalledTimes(11);
  });
  it('the reservation settles to the usage the model reports, so honest questions are not over-counted', async () => {
    freshDay();
    // 100 tokens in + 50 out → ceil(2.67 + 10.24) = 13 neurons, against a reservation of 105.
    const e = env({ ...ALWAYS(), CLIENT_DAILY_NEURONS: '300', AI: { run: vi.fn(async () => ({ response: 'ok', usage: { prompt_tokens: 100, completion_tokens: 50 } })) } });
    const ip = freshIp();
    let ok = 0;
    for (let n = 0; n < 50 && (await call({ ip }, e)).status === 200; n++) ok++;
    expect(ok).toBe(16);                                // 15 × 13 = 195, +105 still fits at 300; 16 × 13 + 105 doesn't
  });
  it('a failed model call is refunded', async () => {
    freshDay();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = env({ ...ALWAYS(), CLIENT_DAILY_NEURONS: String(SMALL), AI: { run: vi.fn(async () => { throw new Error('3040: Capacity temporarily exceeded'); }) } });
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await call({ ip }, e)).status).toBe(503);
    e.AI.run.mockResolvedValue({ response: 'ok' });
    expect((await call({ ip }, e)).status).toBe(200);
    expect((await call({ ip }, e)).status).toBe(429);
  });
  it('/tts is charged by the characters spoken, against the same budgets', async () => {
    freshDay();
    // 1200 characters ≈ 86 s of speech ≈ ceil(1200 × 18.63 / 840) = 27 neurons.
    const e = env({ ...ALWAYS(), CLIENT_DAILY_NEURONS: String(SMALL + 27), AI: { run: vi.fn(async () => ({ audio: btoa('ID3') })) } });
    const ip = freshIp();
    expect((await call({ ip, path: 'tts', body: { text: 'w'.repeat(5000) } }, e)).status).toBe(200);
    expect((await call({ ip, path: 'tts', body: { text: 'w' } }, e)).status).toBe(200);     // 28 so far
    e.AI.run.mockResolvedValue({ response: 'ok' });
    expect((await call({ ip }, e)).status).toBe(429);                                      // 28 + 105 > 132
  });
});

describe('daily budgets (the FirstMateBudget Durable Object)', () => {
  it('counts every request in the one shared object, and refuses past either ceiling', async () => {
    freshDay();
    const b = budgetObject();
    const e = env({ ...ALWAYS(), BUDGET: b.BUDGET, DAILY_NEURON_BUDGET: String(5 * SMALL), CLIENT_DAILY_NEURONS: String(2 * SMALL) });
    const ip = freshIp();
    expect((await call({ ip }, e)).status).toBe(200);
    expect((await call({ ip }, e)).status).toBe(200);
    expect((await call({ ip }, e)).status).toBe(429);
    expect(b.BUDGET.idFromName).toHaveBeenCalledWith('daily');
    expect(b.data.get('spent')).toBe(2 * SMALL);
    expect((await call({}, e)).status).toBe(200);
    expect((await call({}, e)).status).toBe(200);
    expect((await call({}, e)).status).toBe(200);
    const r = await call({}, e);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'ai_unavailable', retryAfter: TO_MIDNIGHT });
    expect(e.AI.run).toHaveBeenCalledTimes(5);
  });
  it('stores no address: clients are salted hashes, and everything is deleted at the next UTC day', async () => {
    freshDay();
    const b = budgetObject();
    const e = env({ ...ALWAYS(), BUDGET: b.BUDGET });
    const ips = ['203.0.113.7', '2001:db8:1:2::9'];
    for (const ip of ips) await call({ ip }, e);
    const dump = JSON.stringify([...b.data]);
    expect(dump).not.toMatch(/203\.0\.113|2001:db8/);
    const clients = [...b.data.keys()].filter((k) => k.startsWith('c:'));
    expect(clients).toHaveLength(2);
    for (const k of clients) expect(k).toMatch(/^c:[0-9a-f]{32}$/);
    const salt = b.data.get('salt');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);

    vi.setSystemTime(Date.now() + TO_MIDNIGHT * 1000);
    await call({ ip: ips[0] }, e);
    expect(b.storage.deleteAll).toHaveBeenCalledTimes(2);                             // the first day's setup, then the reset
    expect(b.data.get('salt')).not.toBe(salt);
    expect(b.data.get('spent')).toBe(SMALL);
    expect([...b.data.keys()].filter((k) => k.startsWith('c:'))).toHaveLength(1);
    expect([...b.data.keys()].filter((k) => k.startsWith('c:'))).not.toContain(clients[0]);  // same address, new day: unlinkable
  });
  it('requests that arrive together cannot both spend the last of the budget', async () => {
    freshDay();
    const b = budgetObject();
    const e = env({ ...ALWAYS(), BUDGET: b.BUDGET, DAILY_NEURON_BUDGET: String(2 * SMALL) });
    const statuses = await Promise.all(Array.from({ length: 6 }, () => call({}, e).then((r) => r.status)));
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(statuses.filter((s) => s === 503)).toHaveLength(4);
    expect(b.state.blockConcurrencyWhile).toHaveBeenCalled();
  });
  it('settles to reported usage after the reply (waitUntil when the runtime has it), and refunds failures', async () => {
    freshDay();
    const b = budgetObject();
    const pending = [];
    const ctx = { waitUntil: vi.fn((p) => { pending.push(p); }) };
    const e = env({ ...ALWAYS(), BUDGET: b.BUDGET, AI: { run: vi.fn(async () => ({ response: 'ok', usage: { prompt_tokens: 100, completion_tokens: 50 } })) } });
    const r = await worker.fetch(req({}), e, ctx);
    expect(r.status).toBe(200);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    await Promise.all(pending);
    expect(b.data.get('spent')).toBe(13);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    e.AI.run.mockRejectedValue(new Error('model exploded'));
    expect((await call({}, e)).status).toBe(503);
    expect(b.data.get('spent')).toBe(13);
  });
  it('a settlement for a day that has ended is ignored, never charged to the new day', async () => {
    const t = freshDay();
    const b = budgetObject();
    const e = env({ ...ALWAYS(), BUDGET: b.BUDGET });
    await call({}, e);
    vi.setSystemTime(t + TO_MIDNIGHT * 1000);
    await call({}, e);
    const day1 = new Date(t).toISOString().slice(0, 10);
    const res = await b.stub.fetch('https://budget/', { method: 'POST', body: JSON.stringify({ op: 'settle', key: '198.51.100.1', cost: -50, day: day1 }) });
    expect(await res.json()).toEqual({ ok: true });
    expect(b.data.get('spent')).toBe(SMALL);
  });
  it('a malformed operation is refused', async () => {
    const b = budgetObject();
    for (const body of ['nope', JSON.stringify({ op: 'drain', key: 'x', cost: 1 }), JSON.stringify({ op: 'charge', key: 'x', cost: 'lots' })]) {
      expect((await b.stub.fetch('https://budget/', { method: 'POST', body })).status).toBe(400);
    }
    expect(b.storage.put).not.toHaveBeenCalled();
  });
  it('an object that fails falls back to the in-isolate ledger (still enforced, logged)', async () => {
    freshDay();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const BUDGET = { idFromName: () => 'id', get: () => ({ fetch: async () => { throw new Error('object overloaded'); } }) };
    const e = env({ ...ALWAYS(), BUDGET, CLIENT_DAILY_NEURONS: String(SMALL) });
    const ip = freshIp();
    expect((await call({ ip }, e)).status).toBe(200);
    expect((await call({ ip }, e)).status).toBe(429);
    expect(log.mock.calls[0][0]).toMatch(/^first-mate budget object failed, using the fallback: object overloaded/);
  });
});

describe('wrangler.toml', () => {
  it('binds Workers AI as AI and declares the same limits the fallback enforces, no account id', () => {
    expect(TOML).toMatch(/^\[ai\]\s*\nbinding = "AI"/m);
    const block = (name) => {
      const m = TOML.match(new RegExp('name = "' + name + '"\\s*\\nnamespace_id = "(\\d+)"\\s*\\n\\s*\\[ratelimits\\.simple\\]\\s*\\n\\s*limit = (\\d+)\\s*\\n\\s*period = (\\d+)'));
      return m && { ns: m[1], limit: Number(m[2]), period: Number(m[3]) };
    };
    expect(block('CHAT_LIMITER')).toMatchObject({ limit: 10, period: 60 });
    expect(block('TTS_LIMITER')).toMatchObject({ limit: 20, period: 60 });
    expect(block('CHAT_LIMITER').ns).not.toBe(block('TTS_LIMITER').ns);
    expect(TOML).toMatch(/^main = "first-mate-worker\.js"/m);
    expect(TOML).not.toMatch(/^account_id/m);
  });
  it('binds the budget object as BUDGET with a SQLite migration (the only kind Workers Free allows)', () => {
    expect(TOML).toMatch(/^\[\[durable_objects\.bindings\]\]\s*\nname = "BUDGET"\s*\nclass_name = "FirstMateBudget"/m);
    expect(TOML).toMatch(/^\[\[migrations\]\]\s*\ntag = "v1"\s*\nnew_sqlite_classes = \["FirstMateBudget"\]/m);
    expect(TOML).not.toMatch(/^new_classes/m);
  });
  it('sets the daily budgets as plain numbers the Worker reads', () => {
    expect(TOML).toMatch(/^DAILY_NEURON_BUDGET = "10000"$/m);
    expect(TOML).toMatch(/^CLIENT_DAILY_NEURONS = "2500"$/m);
  });
  it('keeps the Worker\'s own log lines but not a per-request log (client IP and location) for every call', () => {
    expect(TOML).toMatch(/^\[observability\]\s*\nenabled = true/m);
    expect(TOML).toMatch(/^\[observability\.logs\]\s*\n(?:.*\n)*?invocation_logs = false/m);
  });
});

describe('Workers AI failures', () => {
  it('a thrown model error → 503 ai_unavailable, nothing internal leaked, one short log line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const e = env({ AI: { run: vi.fn(async () => { throw new Error('3040: Capacity temporarily exceeded, please try again. ' + 'trace '.repeat(100)); }) } });
    const r = await call({}, e);
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('30');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ error: 'ai_unavailable', retryAfter: 30 });
    expect(text).not.toMatch(/3040|Capacity|trace/);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^first-mate chat ai_unavailable: 3040: Capacity/);
    expect(log.mock.calls[0][0].length).toBeLessThan(260);
  });
  it('the daily neuron allowance spent → wait until the 00:00 UTC reset', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 26, 23, 0, 0));
    const e = env({ AI: { run: vi.fn(async () => { throw new Error('3036: you have used up your daily free allocation of 10,000 neurons, please upgrade'); }) } });
    const r = await call({}, e);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'ai_unavailable', retryAfter: 3600 });
    expect(r.headers.get('Retry-After')).toBe('3600');
  });
  it('chat with no AI binding → 503 (and says why in the log only)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await call({}, {});
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'ai_unavailable', retryAfter: 30 });
    expect(log.mock.calls[0][0]).toMatch(/no AI binding/);
  });
  it('/tts: a thrown error or a reply without audio → 503; no binding → 501', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const boom = env({ AI: { run: vi.fn(async () => { throw new Error('model exploded at line 9'); }) } });
    const r1 = await call({ path: 'tts', body: { text: 'hello' } }, boom);
    expect(r1.status).toBe(503);
    expect(await r1.json()).toEqual({ error: 'ai_unavailable', retryAfter: 30 });
    const empty = env({ AI: { run: vi.fn(async () => ({})) } });
    expect((await call({ path: 'tts', body: { text: 'hello' } }, empty)).status).toBe(503);
    expect(log.mock.calls.at(-1)[0]).toBe('first-mate tts ai_unavailable: no audio in the reply');
    const bad = env({ AI: { run: vi.fn(async () => ({ audio: '***not base64***' })) } });
    expect((await call({ path: 'tts', body: { text: 'hello' } }, bad)).status).toBe(503);
    const none = await call({ path: 'tts', body: { text: 'hello' } }, {});
    expect(none.status).toBe(501);
    expect(await none.json()).toEqual({ error: 'not_configured' });
  });
});

describe('happy path', () => {
  it('chat: 200 JSON { reply } from the 70B model with the 512-token cap', async () => {
    const e = env();
    const r = await call({ body: { system: 'Be brief.', messages: [{ role: 'user', content: 'tides?' }] } }, e);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.json()).toEqual({ reply: 'ahoy' });
    expect(e.AI.run).toHaveBeenCalledWith(MODEL, {
      messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: 'tides?' }],
      max_tokens: 512,
    });
  });
  it('/tts: decoded MP3 bytes, not cached', async () => {
    const e = env({ AI: { run: vi.fn(async () => ({ audio: btoa('ID3\x01\xff') })) } });
    const r = await call({ path: 'tts', body: { text: '  hello  ', voice: 'ignored' } }, e);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0x49, 0x44, 0x33, 0x01, 0xff]);
    expect(e.AI.run).toHaveBeenCalledWith('@cf/myshell-ai/melotts', { prompt: 'hello', lang: 'en' });
  });
});
