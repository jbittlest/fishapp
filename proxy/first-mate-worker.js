/* ============================================================================
   First Mate free-AI proxy — a Cloudflare Worker.

   Gives FishApp users free, no-API-key conversational AI. The Worker runs an
   open model on Cloudflare's Workers AI, so the app never holds a key — the
   model runs on Cloudflare, billed to this Worker's account.

   ---- DEPLOYING ----
   Preferred: one command from proxy/ (see proxy/README.md):
       npx wrangler@4 login      (once — you sign in yourself)
       npx wrangler@4 deploy     (reads wrangler.toml: the AI binding, rate limits, the
                                  daily budget object and the allowed origins)

   Dashboard alternative (no command line):
   1. https://dash.cloudflare.com → "Workers & Pages" → "Create" → "Create Worker",
      name it "first-mate" → "Deploy".
   2. "Edit code", DELETE the sample, PASTE this whole file, "Deploy".
   3. Worker → "Settings" → "Bindings" → "Add" → "Workers AI" → variable name
      exactly  AI  → Deploy.
   The dashboard can't add rate-limit bindings or the budget object's migration, so a
   pasted Worker falls back to the small per-instance limiter and ledger below (best
   effort), with the built-in origins and budgets. wrangler deploy gets the real ones.

   The app's default endpoint is ASST_PROXY in src/engine/assistant.js
   (https://first-mate.<your workers.dev subdomain>.workers.dev).

   ---- COST ----
   The free allowance is 10,000 neurons a day for the whole account, shared by
   every user — roughly 70 typical First Mate questions with the model below.
   The daily budgets below keep one client, and the relay as a whole, inside a set
   number of neurons a day. proxy/README.md has the arithmetic and the Workers Paid price.

   ---- VOICE (/tts) ----
   The /tts route gives First Mate a real voice instead of the phone's robotic one.
   It uses the SAME "AI" binding as the chat, so there is nothing else to configure.

   The voice runs on Cloudflare Workers AI only. An earlier version also sent the
   text to OpenAI when an OPENAI_KEY secret was set; that path is gone, because
   the app's privacy policy and its cloud-AI consent question name Cloudflare
   (and Anthropic, with the user's own key) — not OpenAI. Adding another TTS
   provider back means naming it there first. An OPENAI_KEY secret left on the
   Worker is now simply ignored.
   ============================================================================ */

/* Who may call the relay: the FishApp website and the FishApp iPhone app. wrangler.toml sets
   them as ALLOWED_ORIGINS (comma-separated), so a rename or a custom domain is a config change and
   a redeploy; this list is only the fallback for a Worker pasted without that variable. A unit
   test checks that the site origin in src/site.config.json is in both, so they can't drift apart.
   The iPhone app's pages load from the registered custom scheme fishapp://app/ (FishApp-iOS
   WebAppView.swift — chosen precisely because it gives the app a stable, non-opaque origin), so
   WKWebView sends `Origin: fishapp://app`. The literal `null` is never accepted, even if it is
   configured: every sandboxed iframe, data: URL and file:// page on the web sends it, so allowing
   it would hand the free chat and voice to any site. Check the real Origin header from an iOS
   build before deploying. A request with no Origin header at all (not a browser) is let through
   as before: this is a soft anti-abuse guard, not auth. */
const DEFAULT_ALLOWED_ORIGINS = 'https://jbittlest.github.io,fishapp://app';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const TTS_MODEL = '@cf/myshell-ai/melotts';
const MAX_TOKENS = 512;

/* What the chat route forwards to the model: the system prompt (at most 8,000 characters and
   3,000 estimated tokens), then the newest messages — at most 12, each cut to 4,000 characters —
   while the whole input stays within 4,000 estimated tokens. Older history that doesn't fit is
   dropped; the question itself always goes, cut to fit. A request of ordinary text therefore costs
   at most about 4,000 × 0.0267 + 512 × 0.205 ≈ 212 neurons (it used to be 8,000 characters plus
   12 × 4,000, about 478); text crafted to tokenize worse can cost more, which the daily ledger
   catches by settling to the usage the model reports. The app trims to the same numbers before
   sending (asstProxyBody in src/engine/assistant.js): keep the two in step — a unit test runs the
   app's body through this Worker and checks that nothing is cut. */
const SYSTEM_MAX_CHARS = 8000;
const SYSTEM_MAX_TOKENS = 3000;
const MAX_MESSAGES = 12;
const MESSAGE_MAX_CHARS = 4000;
const MAX_INPUT_TOKENS = 4000;
const TTS_MAX_CHARS = 1200;

/* The app keeps its chat body under 60 KB, in bytes (asstProxyBody). Anything over 64 KB is
   refused before it is parsed, so a junk upload costs neither CPU nor AI. */
const MAX_BODY_BYTES = 64 * 1024;

/* Per-client limits, keyed by the caller's IP (an IPv6 caller by its /64, which one phone or
   home usually owns whole). Both are per minute and generous for a person: an answer takes a
   few seconds to arrive and longer to read, and every answer may be spoken. They stop bursts;
   the daily budgets below are what stop one client spending the day's neurons. Carrier NAT can
   put several anglers behind one address, hence the headroom.
   With wrangler.toml the limits run on Cloudflare's rate-limit bindings (same numbers there —
   keep them in step); without a binding the in-isolate fallback below applies them instead. */
const LIMITS = {
  chat: { binding: 'CHAT_LIMITER', limit: 10, period: 60 },
  tts: { binding: 'TTS_LIMITER', limit: 20, period: 60 },
};

/* ---- Daily budgets, in Workers AI neurons, reset at 00:00 UTC with the free allowance ----
   10 chats a minute all day from one address is 14,400 requests, so the per-minute limits alone
   can't protect the account's shared allowance (or, on Workers Paid, the bill). Two ceilings:
   - DAILY_NEURON_BUDGET, the whole relay. Default 10,000: the account's free allowance, so even
     on Workers Paid the relay costs nothing beyond the plan until the owner raises it. Once it is
     spent every caller gets 503 ai_unavailable with retryAfter = the time left to 00:00 UTC.
   - CLIENT_DAILY_NEURONS, one client (the same key as the per-minute limits). Default 2,500,
     about 16 typical questions with the voice on, so no single address can use up the day for
     everyone; past it that client gets 429 daily_limit until 00:00 UTC.
   Both can be set as [vars] in wrangler.toml. A request reserves its worst case before the model
   runs (its input estimate plus all 512 output tokens), then settles to the usage the model
   reports, and is refunded if the model fails. The counts live in one Durable Object
   (FirstMateBudget, bound as BUDGET) so every Cloudflare location shares them; without that
   binding, or if it fails, an in-isolate ledger applies the same numbers per instance — a brake,
   not a ceiling, like the fallback limiter. */
const DAILY_NEURON_BUDGET = 10000;
const CLIENT_DAILY_NEURONS = 2500;
// Workers AI rates (proxy/README.md, checked 2026-10-26), in neurons.
const NEURONS_PER_INPUT_TOKEN = 26668 / 1e6;
const NEURONS_PER_OUTPUT_TOKEN = 204805 / 1e6;
const NEURONS_PER_TTS_CHAR = 18.63 / 60 / 14;     // 18.63 an audio minute, ~14 characters a second

// How long to tell the app to stay away after a Workers AI hiccup (capacity, model error).
const AI_RETRY_S = 30;

export default {
  async fetch(request, env, ctx) {
    const origins = allowedOrigins(env);
    const origin = request.headers.get('Origin') || '';
    const allowed = !origin || origins.includes(origin);
    const cors = {
      /* CORS takes exactly one origin, so echo the caller's — a refused one too. The refusal is
         made here, not by the browser: a refused page gets a readable 403 with nothing in it,
         where it used to get a CORS failure the app couldn't tell from having no signal, so it
         kept offering the relay and retried every question. */
      'Access-Control-Allow-Origin': origin || origins[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      // Retry-After isn't a CORS-safelisted header; without this the app can't read it.
      'Access-Control-Expose-Headers': 'Retry-After',
      // Every chat POST is preflighted; caching the answer halves the requests on the free plan.
      'Access-Control-Max-Age': '7200',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'post_only' }, 405, cors);
    // soft anti-abuse guard: only accept browser requests from the FishApp site or app
    if (!allowed) return json({ error: 'forbidden' }, 403, cors);

    const route = new URL(request.url).pathname.replace(/\/+$/, '') === '/tts' ? 'tts' : 'chat';
    const key = clientKey(request);
    const wait = await overLimit(env, route, key);
    if (wait) return json({ error: 'rate_limited', retryAfter: wait }, 429, { ...cors, 'Retry-After': String(wait) });

    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw == null) return json({ error: 'too_large' }, 413, cors);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return json({ error: 'bad_json' }, 400, cors); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad_request' }, 400, cors);

    const call = { env, ctx, cors, key };
    return route === 'tts' ? tts(body, call) : chat(body, call);
  },
};

/* The configured origins (wrangler.toml ALLOWED_ORIGINS, else the built-in list), lower-cased,
   without a trailing slash, and never `null`. */
function allowedOrigins(env) {
  const list = (s) => String(s || '').split(/[\s,]+/)
    .map((o) => o.trim().toLowerCase().replace(/\/+$/, ''))
    .filter((o) => o && o !== 'null');
  const configured = list(env && env.ALLOWED_ORIGINS);
  return configured.length ? configured : list(DEFAULT_ALLOWED_ORIGINS);
}

async function chat(body, call) {
  const { env, cors } = call;
  if ((body.system != null && typeof body.system !== 'string') || (body.messages != null && !Array.isArray(body.messages))) {
    return json({ error: 'bad_request' }, 400, cors);
  }
  const valid = (body.messages || []).filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (valid.length === 0 || valid[valid.length - 1].role !== 'user') return json({ error: 'no_user_message' }, 400, cors);
  if (!env || !env.AI) return aiUnavailable('chat', 'no AI binding (add Workers AI as "AI")', cors);

  const { messages, tokens } = fitChat(body.system || '', valid);
  const reserved = Math.ceil(tokens * NEURONS_PER_INPUT_TOKEN + MAX_TOKENS * NEURONS_PER_OUTPUT_TOKEN);
  const charge = await budgetCharge(env, call.key, reserved);
  if (!charge.ok) return budgetRefused(charge, cors);

  let out;
  try {
    out = await env.AI.run(MODEL, { messages, max_tokens: MAX_TOKENS });
  } catch (e) {
    await afterReply(call, budgetSettle(env, call.key, charge, -reserved));
    return aiUnavailable('chat', e, cors);
  }
  const u = out && out.usage;
  if (u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens)) {
    const used = Math.ceil(u.prompt_tokens * NEURONS_PER_INPUT_TOKEN + u.completion_tokens * NEURONS_PER_OUTPUT_TOKEN);
    await afterReply(call, budgetSettle(env, call.key, charge, used - reserved));
  }
  const reply = (out && (out.response || out.result || out.output_text || '')) || '';
  return json({ reply: String(reply).trim() }, 200, cors);
}

/* The model input for a chat request, within the caps above, and its estimated input tokens. */
function fitChat(system, valid) {
  const sys = cutToTokens(system.slice(0, SYSTEM_MAX_CHARS), SYSTEM_MAX_TOKENS);
  let room = MAX_INPUT_TOKENS - estTokens(sys);
  const kept = [];
  for (let i = valid.length - 1; i >= 0 && kept.length < MAX_MESSAGES; i--) {
    let content = valid[i].content.slice(0, MESSAGE_MAX_CHARS);
    if (estTokens(content) > room) {
      if (kept.length) break;                 // older history that doesn't fit is dropped
      content = cutToTokens(content, room);   // the question always goes, cut to fit
    }
    room -= estTokens(content);
    kept.unshift({ role: valid[i].role, content });
  }
  return { messages: sys ? [{ role: 'system', content: sys }, ...kept] : kept, tokens: MAX_INPUT_TOKENS - room };
}

/* Tokens a text will cost, estimated on the high side for ordinary text in any language on
   Llama 3: about 4 ASCII characters a token, and every other UTF-16 unit (accents, CJK, emoji
   halves) a token of its own. The app uses the same estimate (asstEstTokens). */
function estTokens(s) {
  let ascii = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 4) + (s.length - ascii);
}
/* The longest start of `s` within `max` estimated tokens, never splitting a surrogate pair. */
function cutToTokens(s, max) {
  if (estTokens(s) <= max) return s;
  let ascii = 0, other = 0, i = 0;
  for (; i < s.length; i++) {
    if (s.charCodeAt(i) < 128) ascii++; else other++;
    if (Math.ceil(ascii / 4) + other > max) break;
  }
  if (i > 0 && (s.charCodeAt(i - 1) & 0xfc00) === 0xd800) i--;
  return s.slice(0, i);
}

/* ---- /tts : natural speech ----------------------------------------------
   iOS Safari won't let a web app use the good system voices, so the built-in
   speech always sounds robotic. This route swaps in a real TTS voice.

   Nothing leaves Cloudflare: the text goes to Workers AI on this Worker's own
   `AI` binding, the processor the privacy policy names. (The OpenAI route that
   used to run first when an OPENAI_KEY secret was set has been removed — see the
   header.) Not configured → 501, and every failure here leaves the app on its
   device voice. */
async function tts(body, call) {
  const { env, cors } = call;
  if (body.text != null && typeof body.text !== 'string') return json({ error: 'bad_request' }, 400, cors);
  const text = (body.text || '').trim().slice(0, TTS_MAX_CHARS);
  if (!text) return json({ error: 'no_text' }, 400, cors);
  if (!env || !env.AI) return json({ error: 'not_configured' }, 501, cors);

  const reserved = Math.ceil(text.length * NEURONS_PER_TTS_CHAR);
  const charge = await budgetCharge(env, call.key, reserved);
  if (!charge.ok) return budgetRefused(charge, cors);
  try {
    // MeloTTS hands back base64, so decode it to real bytes before replying.
    const out = await env.AI.run(TTS_MODEL, { prompt: text, lang: 'en' });
    const b64 = out && (out.audio || out.result || out.output || '');
    if (!b64 || typeof b64 !== 'string') throw new Error('no audio in the reply');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Response(bytes, { headers: { ...cors, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } catch (e) {
    await afterReply(call, budgetSettle(env, call.key, charge, -reserved));
    return aiUnavailable('tts', e, cors);
  }
}

/* Workers AI said no: the day's free neurons are spent (code 3036, formerly 4006), it is out of
   capacity (3040), or the model failed. The app only needs to know "not now, and for how long" —
   the reason goes to the Worker's log for the owner, never to the caller. Spent neurons come back
   at 00:00 UTC, so that is the wait; the app caps what it honours. */
function aiUnavailable(route, e, cors) {
  const msg = String((e && e.message) || e).slice(0, 200);
  const spent = /\b(3036|4006)\b|daily free allocation/i.test(msg);
  const wait = spent ? secondsToUtcMidnight(Date.now()) : AI_RETRY_S;
  console.log('first-mate ' + route + ' ai_unavailable' + (spent ? ' (daily neurons spent)' : '') + ': ' + msg);
  return json({ error: 'ai_unavailable', retryAfter: wait }, 503, { ...cors, 'Retry-After': String(wait) });
}

function secondsToUtcMidnight(now) {
  const d = new Date(now);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - now) / 1000));
}
const utcDay = (now) => new Date(now).toISOString().slice(0, 10);

/* The client's rate-limit key. Cloudflare always sets CF-Connecting-IP in production; it is
   only missing under local tools, which then share one bucket. IPv6 is cut to its /64 because
   a single subscriber can rotate through the rest of it at will. */
function clientKey(request) {
  const ip = (request.headers.get('CF-Connecting-IP') || '').trim().toLowerCase();
  if (!ip) return 'unknown';
  if (!ip.includes(':') || ip.includes('.')) return ip;     // IPv4 (or IPv4-mapped IPv6)
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail == null ? null : (tail ? tail.split(':') : []);
  const groups = t == null ? h : h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t);
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

/* Seconds the caller must wait, or 0 to go ahead. The binding (wrangler.toml) is approximate
   and counted per Cloudflare location, which is fine for its job here. A binding that is
   missing or fails falls back to the in-isolate counter rather than letting everything through. */
async function overLimit(env, route, key) {
  const cfg = LIMITS[route];
  const binding = env && env[cfg.binding];
  if (binding && typeof binding.limit === 'function') {
    try {
      const { success } = await binding.limit({ key: route + ':' + key });
      return success ? 0 : cfg.period;     // the binding doesn't say when its window opens
    } catch (e) {
      console.log('first-mate ' + route + ' rate-limit binding failed, using the fallback: ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  return localLimit(route + ':' + key, cfg.limit, cfg.period * 1000, Date.now());
}

/* Fallback limiter: a fixed window per key, kept in this isolate's memory. Cloudflare runs
   many isolates and recycles them, so it is a brake, not a guarantee — enough to stop one
   client hammering one instance when the Worker was pasted into the dashboard without bindings. */
const windows = new Map();
const MAX_TRACKED = 5000;
function localLimit(key, limit, periodMs, now) {
  let w = windows.get(key);
  if (!w || now >= w.end) {
    if (windows.size >= MAX_TRACKED) {
      for (const [k, v] of windows) if (now >= v.end) windows.delete(k);
      if (windows.size >= MAX_TRACKED) windows.clear();   // a flood of fresh keys: forget, don't grow
    }
    w = { end: now + periodMs, n: 0 };
    windows.set(key, w);
  }
  if (w.n >= limit) return Math.max(1, Math.ceil((w.end - now) / 1000));
  w.n++;
  return 0;
}

/* ---- The daily ledger ---- */

function budgetLimits(env) {
  const count = (name, dflt) => {
    const v = env && env[name];
    const n = v == null || v === '' ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : dflt;
  };
  return { all: count('DAILY_NEURON_BUDGET', DAILY_NEURON_BUDGET), client: count('CLIENT_DAILY_NEURONS', CLIENT_DAILY_NEURONS) };
}
const budgetStub = (env) => {
  const ns = env && env.BUDGET;
  return ns && typeof ns.idFromName === 'function' ? ns.get(ns.idFromName('daily')) : null;
};
const budgetCall = async (stub, op) => {
  const r = await stub.fetch('https://budget/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(op) });
  if (!r.ok) throw new Error('budget object HTTP ' + r.status);
  return r.json();
};

/* Reserve `cost` neurons for `key` today: { ok: true, day, via } or { ok: false, scope, retryAfter }. */
async function budgetCharge(env, key, cost) {
  const op = { op: 'charge', key, cost, ...budgetLimits(env) };
  const stub = budgetStub(env);
  if (stub) {
    try {
      return { ...(await budgetCall(stub, op)), via: 'object' };
    } catch (e) {
      console.log('first-mate budget object failed, using the fallback: ' + String((e && e.message) || e).slice(0, 120));
    }
  }
  return { ...localLedger(op, Date.now()), via: 'local' };
}
/* Correct a reservation by `delta` neurons (negative = refund), in the ledger that took it. A
   correction that fails leaves the reservation standing: counted high, never low. */
async function budgetSettle(env, key, charge, delta) {
  if (!charge.ok || !delta) return;
  const op = { op: 'settle', key, cost: delta, day: charge.day };
  const stub = charge.via === 'object' && budgetStub(env);
  if (!stub) { localLedger(op, Date.now()); return; }
  try { await budgetCall(stub, op); } catch (e) { /* the reservation stands */ }
}
// Settle after the reply has gone when the runtime allows it; otherwise (tests) before.
function afterReply(call, p) {
  if (call.ctx && typeof call.ctx.waitUntil === 'function') { call.ctx.waitUntil(p); return undefined; }
  return p;
}

let spentLoggedDay = '';
function budgetRefused(charge, cors) {
  const wait = charge.retryAfter || secondsToUtcMidnight(Date.now());
  const headers = { ...cors, 'Retry-After': String(wait) };
  if (charge.scope === 'client') return json({ error: 'daily_limit', retryAfter: wait }, 429, headers);
  const day = utcDay(Date.now());
  if (spentLoggedDay !== day) {
    spentLoggedDay = day;
    console.log('first-mate daily budget spent (DAILY_NEURON_BUDGET); answering 503 until 00:00 UTC');
  }
  return json({ error: 'ai_unavailable', retryAfter: wait }, 503, headers);
}

// A charge that would pass a ceiling → the refusal, else null.
function overBudget(spent, mine, op, now) {
  if (spent + op.cost > op.all) return { ok: false, scope: 'all', retryAfter: secondsToUtcMidnight(now) };
  if (mine + op.cost > op.client) return { ok: false, scope: 'client', retryAfter: secondsToUtcMidnight(now) };
  return null;
}

/* Fallback ledger, in this isolate's memory: the same budgets, counted per instance. */
const local = { day: '', spent: 0, clients: new Map() };
function localLedger(op, now) {
  const day = utcDay(now);
  if (local.day !== day) {
    if (op.op === 'settle') return { ok: true };         // yesterday's reservation; today starts clean
    local.day = day; local.spent = 0; local.clients.clear();
  }
  if (op.op === 'settle' && op.day !== day) return { ok: true };
  const mine = local.clients.get(op.key) || 0;
  if (op.op === 'charge') {
    const no = overBudget(local.spent, mine, op, now);
    if (no) return no;
    if (!local.clients.has(op.key) && local.clients.size >= MAX_TRACKED) local.clients.clear();
  }
  local.spent = Math.max(0, local.spent + op.cost);
  local.clients.set(op.key, Math.max(0, mine + op.cost));
  return { ok: true, day };
}

/* The shared ledger: one Durable Object instance ('daily') holds today's totals, so every
   Cloudflare location counts against the same numbers. SQLite-backed (the only kind the Workers
   Free plan allows; wrangler.toml declares it), used through the plain key-value API. Each
   operation runs with other requests held back, so two requests can't both spend the last
   neurons. A client is stored only as a salted SHA-256 of its key, never the address itself, and
   the salt is random per day: at the first request after 00:00 UTC everything — salt, totals,
   client entries — is deleted and the day starts fresh. */
export class FirstMateBudget {
  constructor(state) { this.state = state; }

  async fetch(request) {
    let op = null;
    try { op = await request.json(); } catch (e) { /* not JSON */ }
    if (!op || (op.op !== 'charge' && op.op !== 'settle') || typeof op.key !== 'string' || !Number.isFinite(op.cost)) {
      return new Response('bad request', { status: 400 });
    }
    const out = await this.state.blockConcurrencyWhile(() => this.apply(op, Date.now()));
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  }

  async apply(op, now) {
    const store = this.state.storage;
    const day = utcDay(now);
    const head = await store.get(['day', 'salt', 'spent']);
    let salt = head.get('salt');
    let spent = head.get('spent') || 0;
    if (head.get('day') !== day) {
      if (op.op === 'settle') return { ok: true };
      await store.deleteAll();
      salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      spent = 0;
      await store.put({ day, salt, spent });
    }
    if (op.op === 'settle' && op.day !== day) return { ok: true };
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + op.key)));
    const mineKey = 'c:' + [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const mine = (await store.get(mineKey)) || 0;
    if (op.op === 'charge') {
      const no = overBudget(spent, mine, op, now);
      if (no) return no;
    }
    await store.put({ spent: Math.max(0, spent + op.cost), [mineKey]: Math.max(0, mine + op.cost) });
    return { ok: true, day };
  }
}

/* The body as text, or null when it is over `cap` bytes. Content-Length is checked first;
   a body without one (chunked) is counted as it streams and dropped at the cap. */
async function readCapped(request, cap) {
  if (Number(request.headers.get('content-length')) > cap) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > cap) { try { await reader.cancel(); } catch (e) { /* already closed */ } return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'content-type': 'application/json' } });
}
