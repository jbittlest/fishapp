/* ============================================================================
   First Mate free-AI proxy — a Cloudflare Worker.

   Gives FishApp users free, no-API-key conversational AI. The Worker runs an
   open model on Cloudflare's Workers AI (free tier), so the app never holds a
   key — the model runs on Cloudflare, billed to this Worker's free allocation.

   ---- ONE-TIME SETUP (about 5 minutes, all in the Cloudflare dashboard) ----
   1. Make a free account at https://dash.cloudflare.com  (no card needed).
   2. Left sidebar → "Workers & Pages" → "Create" → "Create Worker".
   3. Name it e.g. "first-mate" → "Deploy" (it deploys a hello-world first).
   4. Click "Edit code", DELETE the sample, PASTE this whole file, "Deploy".
   5. Open the Worker → "Settings" → "Bindings" → "Add" → "Workers AI" →
      Variable name MUST be exactly:  AI   → Save/Deploy.
   6. Copy the Worker URL (looks like https://first-mate.<you>.workers.dev).
   7. In FishApp → 💬 First Mate → ⚙️ settings → paste the URL into
      "Free-AI endpoint" → Save. (To turn it on for ALL users, also set
      ASST_PROXY in js/assistant.js to that URL and push.)

   Free tier is ~10,000 "neurons"/day — plenty for personal use. Swap MODEL
   below for a smarter/bigger one any time (e.g. llama-3.3-70b-instruct-fp8-fast).

   ---- UPDATING (natural voice) ----
   Re-pasting this file adds a /tts route that gives First Mate a real voice
   instead of the phone's robotic one. It uses the SAME "AI" binding as the
   chat, so there is nothing else to configure — just paste and Deploy, then
   tick "Natural cloud voice" in the app's ⚙️ settings.

   OPTIONAL, for better-sounding audio: Worker → Settings → Variables and
   Secrets → add secret OPENAI_KEY = sk-... → Deploy. It's used when present
   and costs roughly a cent per reply; without it the free voice is used.
   ============================================================================ */

const ALLOWED_ORIGIN = 'https://jbittlest.github.io';   // lock the endpoint to the FishApp site
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TOKENS = 512;

/* Natural speech for the /tts route (see below). Works with NO extra setup — it falls back
   to Workers AI TTS on the same `AI` binding the chat already uses. Adding an OPENAI_KEY
   secret is optional and buys better-sounding audio at a per-use cost. */
const TTS_MODEL = 'gpt-4o-mini-tts';
const TTS_VOICE = 'onyx';                                // calm, low — suits a boat
const ALLOWED_TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
    // soft anti-abuse guard: only accept browser requests from the FishApp origin
    if (origin && origin !== ALLOWED_ORIGIN) return new Response('forbidden', { status: 403, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, cors); }

    /* ---- /tts : natural speech ----------------------------------------------
       iOS Safari won't let a web app use the good system voices, so the built-in
       speech always sounds robotic. This route swaps in a real TTS voice.

       The key lives HERE, in the Worker — never in the phone. Calling OpenAI
       straight from the browser also trips CORS, so proxying is required, not
       merely tidier.

       SETUP: Worker → Settings → Variables and Secrets → add secret
              OPENAI_KEY = sk-...     (then Deploy)
       Not configured → returns 501 and the app quietly keeps its device voice. */
    if (new URL(request.url).pathname.replace(/\/+$/, '') === '/tts') {
      const text = String(body.text || '').trim().slice(0, 1200);
      if (!text) return json({ error: 'no text' }, 400, cors);
      const audio = { ...cors, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' };

      // Best quality, only if you've added an OPENAI_KEY secret (optional — costs per use).
      if (env.OPENAI_KEY) {
        try {
          const r = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.OPENAI_KEY },
            body: JSON.stringify({
              model: TTS_MODEL,
              voice: ALLOWED_TTS_VOICES.includes(body.voice) ? body.voice : TTS_VOICE,
              input: text,
              response_format: 'mp3',
            }),
          });
          if (r.ok) return new Response(r.body, { headers: audio });
          // fall through to the free voice rather than failing outright
        } catch (e) { /* fall through */ }
      }

      /* Free path — Workers AI TTS on the SAME `AI` binding the chat already uses, so it
         needs no key, no extra account and costs nothing beyond the free allocation.
         MeloTTS hands back base64, so decode it to real bytes before replying. */
      if (env.AI) {
        try {
          const out = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang: 'en' });
          const b64 = out && (out.audio || out.result || out.output || '');
          if (b64 && typeof b64 === 'string') {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new Response(bytes, { headers: audio });
          }
          return json({ error: 'tts returned no audio' }, 502, cors);
        } catch (e) {
          return json({ error: String((e && e.message) || e) }, 502, cors);
        }
      }
      return json({ error: 'tts not configured' }, 501, cors);
    }

    const messages = [];
    if (body.system) messages.push({ role: 'system', content: String(body.system).slice(0, 8000) });
    (Array.isArray(body.messages) ? body.messages : []).slice(-12).forEach((m) => {
      if (m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') {
        messages.push({ role: m.role, content: m.content.slice(0, 4000) });
      }
    });
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'no user message' }, 400, cors);
    }

    try {
      const out = await env.AI.run(MODEL, { messages, max_tokens: MAX_TOKENS });
      const reply = (out && (out.response || out.result || out.output_text || '')) || '';
      return json({ reply: String(reply).trim() }, 200, cors);
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 502, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'content-type': 'application/json' } });
}
