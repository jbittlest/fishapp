// @vitest-environment node
/* proxy/first-mate-worker.js — the origin lock. The FishApp site and the iOS app (custom
   scheme: Origin 'fishapp://app') get in; every other browser origin is refused — including
   'null', which any sandboxed iframe, data: URL or file:// page sends. */
import { describe, it, expect, vi } from 'vitest';
import worker from '../../../proxy/first-mate-worker.js';

const URL0 = 'https://first-mate.example.workers.dev/';
function req(origin, { method = 'POST', body = { messages: [{ role: 'user', content: 'hi' }] }, path = '' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (origin != null) headers.Origin = origin;
  return new Request(URL0 + path, { method, headers, body: method === 'POST' ? JSON.stringify(body) : undefined });
}
const env = () => ({ AI: { run: vi.fn(async () => ({ response: ' ahoy ' })) } });

describe('first-mate worker origin lock', () => {
  it.each(['https://jbittlest.github.io', 'fishapp://app'])('allows %s and echoes it for CORS', async (origin) => {
    const pre = await worker.fetch(req(origin, { method: 'OPTIONS' }), env());
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const r = await worker.fetch(req(origin), env());
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(await r.json()).toEqual({ reply: 'ahoy' });
  });
  it.each(['https://evil.example', 'http://localhost:5181', 'fishapp://other', 'null'])('refuses %s', async (origin) => {
    const e = env();
    const r = await worker.fetch(req(origin), e);
    expect(r.status).toBe(403);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://jbittlest.github.io');
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it('/tts stays on Workers AI even if an old OPENAI_KEY secret is still set (no undisclosed processor)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const e = { OPENAI_KEY: 'sk-test', AI: { run: vi.fn(async () => ({ audio: btoa('ID3') })) } };
    const r = await worker.fetch(req('fishapp://app', { body: { text: 'hello' }, path: 'tts' }), e);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(e.AI.run).toHaveBeenCalledWith('@cf/myshell-ai/melotts', { prompt: 'hello', lang: 'en' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it('keeps the system prompt cap at 8000 characters and the last 12 messages', async () => {
    const e = env();
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
    messages.push({ role: 'user', content: 'last' });
    await worker.fetch(req('fishapp://app', { body: { system: 's'.repeat(9000), messages } }), e);
    const sent = e.AI.run.mock.calls[0][1].messages;
    expect(sent[0]).toEqual({ role: 'system', content: 's'.repeat(8000) });
    expect(sent).toHaveLength(13);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'last' });
  });
});
