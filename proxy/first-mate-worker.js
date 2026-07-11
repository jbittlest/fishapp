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
