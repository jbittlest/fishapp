// Render public/privacy.html and public/support.html from src/legal/privacy.js — the same text the
// app shows in About, so the App Store "Privacy Policy URL" and the in-app policy can never drift.
//   node tools/make-legal-pages.mjs
import fs from 'node:fs';
import { POLICY, POLICY_UPDATED, SOURCES, SUPPORT_URL, NOT_FOR_NAVIGATION } from '../src/legal/privacy.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, '<a href="$1">$1</a>');

const page = (title, body) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — FishApp</title>
<meta name="color-scheme" content="dark light">
<style>
  :root { --bg:#0F1A25; --text:#F3F6F9; --muted:#B4C0CC; --line:rgba(196,214,232,.14); --accent:#FFB547; }
  @media (prefers-color-scheme: light) { :root { --bg:#F4F4F1; --text:#15171A; --muted:#464B53; --line:rgba(21,23,26,.12); --accent:#8A5200; } }
  html { background: var(--bg); color: var(--text); }
  body { margin: 0 auto; max-width: 720px; padding: calc(env(safe-area-inset-top) + 28px) 22px 48px;
    font: 400 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
  header svg { flex-shrink: 0; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0; }
  h2 { font-size: 18px; margin: 28px 0 6px; }
  p, li { color: var(--muted); }
  b, strong { color: var(--text); }
  a { color: var(--accent); }
  .meta { color: var(--muted); font-size: 14px; margin: 0 0 18px; }
  .note { border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; margin: 18px 0; }
  ul.sources { padding-left: 18px; }
  footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 14px; color: var(--muted); }
</style>
</head><body>
<header>
  <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#0B131C"/><path d="M12 3.5c2.2 2.2 3.4 5.1 3.4 8.5v7.5H8.6V12c0-3.4 1.2-6.3 3.4-8.5z" fill="#FFB547"/></svg>
  <h1>${esc(title)}</h1>
</header>
${body}
<footer>FishApp · <a href="./privacy.html">Privacy</a> · <a href="./support.html">Support</a> · <a href="./">Open the web app</a></footer>
</body></html>
`;

const privacy = page('Privacy Policy', `<p class="meta">Last updated ${esc(POLICY_UPDATED)}</p>
${POLICY.map((s) => `<h2>${esc(s.title)}</h2>\n${s.body.map((p) => `<p>${linkify(p)}</p>`).join('\n')}`).join('\n')}
<h2>Services FishApp contacts</h2>
<ul class="sources">${SOURCES.map((s) => `<li><b>${esc(s.name)}</b> — ${esc(s.what)} · <a href="${esc(s.url)}">${esc(s.url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></li>`).join('')}</ul>`);

const support = page('Support', `<p class="meta">Help with FishApp — offline marine charts, GPS navigation and fishing tools.</p>
<div class="note"><b>Not for navigation.</b> ${esc(NOT_FOR_NAVIGATION)}</div>
<h2>Get help or report a problem</h2>
<p>Open an issue at <a href="${SUPPORT_URL}">${SUPPORT_URL.replace(/^https:\/\//, '')}</a>. Include your device, iOS version and what you were doing. Never post your API key or exact private spots.</p>
<h2>Common questions</h2>
<p><b>Does it work without signal?</b> Yes. Download an area in More › Offline charts while you have internet; the charts and a 7-day forecast, tide and water-temperature pack for that area are stored on your phone. GPS works with no signal.</p>
<p><b>Why does the anchor watch need location in the background?</b> So it can keep checking your position and sound the alarm with the screen locked. It only runs while a watch, a track recording or a route is active.</p>
<p><b>Is First Mate free?</b> Yes. It answers from your boat data offline. With your permission it can use a free cloud AI when you have signal, or Claude if you add your own Anthropic API key.</p>
<p><b>Where is my data?</b> Only on your device. See the <a href="./privacy.html">privacy policy</a>. Back up from Spots &amp; tracks › Export backup.</p>`);

fs.writeFileSync('public/privacy.html', privacy);
fs.writeFileSync('public/support.html', support);
console.log('wrote public/privacy.html and public/support.html');
