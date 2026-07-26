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
   ============================================================================ */

const ALLOWED_ORIGIN = 'https://jbittlest.github.io';   // lock the endpoint to the FishApp site
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TOKENS = 512;

/* Natural speech for the /tts route (see below). Needs an OPENAI_KEY secret on the Worker;
   without it the route 501s and the app falls back to the phone's built-in voice. */
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
      if (!env.OPENAI_KEY) return json({ error: 'tts not configured' }, 501, cors);
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
        if (!r.ok) return json({ error: 'tts upstream ' + r.status }, 502, cors);
        return new Response(r.body, {
          headers: { ...cors, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
        });
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 502, cors);
      }
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
