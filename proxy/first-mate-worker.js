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
   7. In FishApp → First Mate → settings → paste the URL into
      "Free-AI endpoint" → Save. (To turn it on for ALL users, also set
      ASST_PROXY in src/engine/assistant.js to that URL and deploy.)

   Free tier is ~10,000 "neurons"/day — plenty for personal use. Swap MODEL
   below for a smarter/bigger one any time (e.g. llama-3.3-70b-instruct-fp8-fast).

   ---- UPDATING (natural voice) ----
   Re-pasting this file adds a /tts route that gives First Mate a real voice
   instead of the phone's robotic one. It uses the SAME "AI" binding as the
   chat, so there is nothing else to configure — just paste and Deploy, then
   turn on "Natural cloud voice" in First Mate settings.

   The voice runs on Cloudflare Workers AI only. An earlier version also sent the
   text to OpenAI when an OPENAI_KEY secret was set; that path is gone, because
   the app's privacy policy and its cloud-AI consent question name Cloudflare
   (and Anthropic, with the user's own key) — not OpenAI. Adding another TTS
   provider back means naming it there first. An OPENAI_KEY secret left on the
   Worker is now simply ignored.
   ============================================================================ */

const ALLOWED_ORIGIN = 'https://jbittlest.github.io';   // lock the endpoint to the FishApp site
/* ...and to the FishApp iPhone app. Its pages load from the registered custom scheme
   fishapp://app/ (FishApp-iOS WebAppView.swift — chosen precisely because it gives the app a
   stable, non-opaque origin), so WKWebView sends `Origin: fishapp://app`. The literal `null`
   is NOT accepted: every sandboxed iframe, data: URL and file:// page on the web sends it, so
   allowing it would hand the free chat and voice to any site. Check the real Origin header from
   an iOS build before deploying. A request with no Origin header at all (not a browser) is let
   through as before: this is a soft anti-abuse guard, not auth. */
const ALLOWED_ORIGINS = [ALLOWED_ORIGIN, 'fishapp://app'];
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TOKENS = 512;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = !origin || ALLOWED_ORIGINS.includes(origin);
    const cors = {
      // Echo an allowed origin (CORS takes exactly one); anything else gets the site's.
      'Access-Control-Allow-Origin': origin && allowed ? origin : ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: cors });
    // soft anti-abuse guard: only accept browser requests from the FishApp site or app
    if (!allowed) return new Response('forbidden', { status: 403, headers: cors });

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, cors); }

    /* ---- /tts : natural speech ----------------------------------------------
       iOS Safari won't let a web app use the good system voices, so the built-in
       speech always sounds robotic. This route swaps in a real TTS voice.

       Nothing leaves Cloudflare: the text goes to Workers AI on this Worker's own
       `AI` binding, the processor the privacy policy names. (The OpenAI route that
       used to run first when an OPENAI_KEY secret was set has been removed — see the
       header.) Not configured → returns 501 and the app quietly keeps its device voice. */
    if (new URL(request.url).pathname.replace(/\/+$/, '') === '/tts') {
      const text = String(body.text || '').trim().slice(0, 1200);
      if (!text) return json({ error: 'no text' }, 400, cors);
      const audio = { ...cors, 'content-type': 'audio/mpeg', 'cache-control': 'no-store' };

      /* Workers AI TTS on the SAME `AI` binding the chat already uses, so it
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
