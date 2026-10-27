# First Mate relay (Cloudflare Worker)

`first-mate-worker.js` is the free, no-key AI behind First Mate: chat on Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) and the natural voice on `/tts`
(`@cf/myshell-ai/melotts`). It only answers the website (`https://jbittlest.github.io`)
and the iPhone app (`fishapp://app`), limits each client per minute and per day, caps
what the whole relay may spend in a day, and turns every Workers AI failure into a plain
`503 {"error":"ai_unavailable"}`. When the relay says no, the app answers from the
phone's own data.

## 1. Deploy (one command)

From this folder (`proxy/`):

```
npx wrangler@4 login      # once: a browser opens, you sign in to Cloudflare
npx wrangler@4 deploy
```

`wrangler.toml` supplies everything: the Workers AI binding (`AI`), the two rate-limit
bindings, the daily-budget Durable Object (`BUDGET`, with its migration), and the
settings in `[vars]` (allowed origins and the two daily budgets, section 4). There is no
`account_id` in it; wrangler takes it from your login and asks which account if you have
more than one. Rate-limit bindings need wrangler 4.36 or later, which `wrangler@4` gets.
The Durable Object is SQLite-backed, the kind the Workers Free plan includes.

The app calls `https://first-mate.jbittlest.workers.dev` (`ASST_PROXY` in
`src/engine/assistant.js`). Your Worker lands at
`https://first-mate.<your workers.dev subdomain>.workers.dev`, so the subdomain must be
`jbittlest` (dashboard → Workers & Pages → Your subdomain → Change). If it is something
else, set `ASST_PROXY` to the URL `wrangler deploy` prints and rebuild the app.

To redeploy after an edit, run `npx wrangler@4 deploy` again. Live logs:
`npx wrangler@4 tail`, or the Worker's Logs tab in the dashboard (section 6 says what
is kept there).

## 2. Dashboard alternative (no command line)

1. dash.cloudflare.com → Workers & Pages → Create → Create Worker. Name it
   `first-mate` and click Deploy.
2. Edit code. Delete the sample, paste all of `first-mate-worker.js`, then Deploy.
3. Settings → Bindings → Add → Workers AI. The variable name must be exactly `AI`.
   Deploy again.

That is the only binding the dashboard needs. Cloudflare does not show rate-limit
bindings in the dashboard, and the budget object needs a migration only wrangler sends,
so a pasted Worker uses its built-in fallbacks instead: the same per-minute limits and
daily budgets, counted per Worker instance. That is a brake, not a hard limit. Without
`[vars]` it also uses its built-in origins and budgets; you can add the same variables
under Settings → Variables and Secrets. To get the real limiter and ledger, deploy once
with wrangler (section 1). That deploy replaces the dashboard settings with
`wrangler.toml`.

## 3. Check it works

Run these in Git Bash (installed with Git for Windows) or the Mac Terminal:

```bash
W=https://first-mate.jbittlest.workers.dev
Q='{"messages":[{"role":"user","content":"Say ahoy in three words"}]}'

# Website origin → {"reply":"..."} then 200
curl -s -w '\n%{http_code}\n' -H 'Origin: https://jbittlest.github.io' -H 'content-type: application/json' -d "$Q" "$W"

# iPhone app origin → {"reply":"..."} then 200
curl -s -w '\n%{http_code}\n' -H 'Origin: fishapp://app' -H 'content-type: application/json' -d "$Q" "$W"

# Any other site → {"error":"forbidden"} then 403 (the same for 'Origin: null')
curl -s -w '\n%{http_code}\n' -H 'Origin: https://example.com' -H 'content-type: application/json' -d "$Q" "$W"

# Too fast → 429. Each '{}' request counts toward the limit but is rejected before
# the AI runs, so this check costs no neurons.
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' -H 'Origin: https://jbittlest.github.io' -H 'content-type: application/json' -d '{}' "$W"; done; echo
# → a run of 400s, then 429s. The two chat checks above count toward the same limit,
# and the Cloudflare limiter is approximate, so the first 429 can come a few requests
# earlier or later than the 11th.
curl -si -H 'Origin: https://jbittlest.github.io' -H 'content-type: application/json' -d '{}' "$W" | grep -iE '^HTTP|^retry-after|^\{'
# → HTTP/2 429, retry-after: 60, {"error":"rate_limited","retryAfter":60}

# Voice → 200 audio/mpeg (writes ahoy.mp3)
curl -s -o ahoy.mp3 -w '%{http_code} %{content_type}\n' -H 'Origin: https://jbittlest.github.io' -H 'content-type: application/json' -d '{"text":"Ahoy"}' "$W/tts"
```

After the 429 check, chat from your own connection is blocked for up to a minute.

Before launch, also confirm that a real iPhone build sends `Origin: fishapp://app`. If it
does not, the app gets a 403 and First Mate quietly drops to on-phone answers ("AI relay
unavailable" in its status line). Add the origin it does send to `ALLOWED_ORIGINS`, unless
it is `null`, which the Worker never accepts.

## 4. Limits, settings and responses

| Route | Per client | Over the limit |
|---|---|---|
| chat (`/`) | 10 a minute | `429 {"error":"rate_limited","retryAfter":s}` + `Retry-After` |
| `/tts` | 20 a minute | the same |
| both together | `CLIENT_DAILY_NEURONS` a day (2,500) | `429 {"error":"daily_limit","retryAfter":s}`, `s` = time left to 00:00 UTC |
| the whole relay | `DAILY_NEURON_BUDGET` a day (10,000) | `503 {"error":"ai_unavailable","retryAfter":s}`, the same `s` |

A client is one IP address. For IPv6 it is the whole /64, since one subscriber can
rotate through the rest of it. To change a per-minute limit, edit both `wrangler.toml`
and `LIMITS` in the Worker; a unit test checks that they match. The daily budgets are
`[vars]` in `wrangler.toml`; the defaults in the Worker only apply when they are missing.

The daily budgets count estimated neurons (section 5). Each request reserves its worst
case before the model runs, settles to the usage the model reports when it answers, and
is refunded when the model fails. Both budgets reset at 00:00 UTC, when Cloudflare resets
the free allowance. 2,500 a client is about 16 typical questions with the voice on.

What the chat route sends to the model is capped in total, not per message: the system
prompt (at most 8,000 characters and 3,000 estimated tokens), then the newest messages,
at most 12 of 4,000 characters each, while the whole input stays within 4,000 estimated
tokens (about 4 English characters a token, one a character for other scripts). Older
history that doesn't fit is dropped; the question always goes, cut to fit. The app trims
to the same numbers before it sends (`asstProxyBody` in `src/engine/assistant.js`).

`ALLOWED_ORIGINS` lists the browser origins allowed to call the relay. It must include
the origin of `siteUrl` in `src/site.config.json`; a unit test fails when it doesn't. When
the site is renamed or moves to a custom domain, add the new origin (keep the old one
until the move is done), run `npx wrangler@4 deploy`, and only then switch the site.
Otherwise every web user's chat and voice are refused. Requests with no `Origin` header
(scripts, curl) are let through; the per-client limits and budgets still apply to them.

Other responses:

- `400`: the body isn't JSON or has the wrong shape (`bad_json`, `bad_request`,
  `no_user_message`, `no_text`).
- `403 forbidden`: a browser origin that isn't allowed. The reply still carries that
  origin's CORS header, so the app can read it and stop offering the relay, rather than
  seeing what looks like a dropped connection on every question.
- `405 post_only`: any method other than POST or OPTIONS.
- `413 too_large`: the body is over 64 KB. It is refused before parsing. The app keeps its
  bodies under 60 KB, so it only sees this from a different relay.
- `503 ai_unavailable`: Workers AI failed, or the relay's daily budget is spent.
  `retryAfter` is 30 s, or the time left until 00:00 UTC when the day's neurons are spent
  (the relay's budget or Cloudflare's free allowance). The real reason goes to the Worker
  log as a line starting `first-mate chat ai_unavailable`, `first-mate tts ...` or
  `first-mate daily budget spent`, and never reaches the caller.

The app waits out `retryAfter`. It honours at most 30 minutes before trying again. While
it waits, it answers from the phone and does not call the relay.

## 5. Cost

Rates checked on Cloudflare's Workers AI pricing page on 2026-10-26:

- 10,000 neurons a day are free on both the Free and Paid plans. The allowance is per
  account, so every user shares it. It resets at 00:00 UTC (5 PM Pacific in summer,
  4 PM in winter).
- Above that, Workers Paid charges $0.011 per 1,000 neurons. The plan itself costs at
  least $5 a month.
- `llama-3.3-70b-instruct-fp8-fast`: 26,668 neurons per million input tokens ($0.293)
  and 204,805 neurons per million output tokens ($2.253).
- `melotts`: 18.63 neurons per audio minute ($0.0002).

A typical First Mate question is about 3,000 input tokens (the system prompt included)
and 300 output tokens:

```
input   3,000 × 26,668 / 1,000,000  =  80.0 neurons
output    300 × 204,805 / 1,000,000 =  61.4 neurons
                                      ---------------
per question                          141.4 neurons

free allowance   10,000 / 141.4  ≈  70 questions a day, for all users together

Workers Paid     141.4 × $0.011 / 1,000  =  $0.00156 a question
                 ≈ $1.56 per 1,000 questions
                 (check with token prices: 3,000 × $0.293/M + 300 × $2.253/M = $0.00155)
```

A spoken answer adds MeloTTS. At most 700 characters, about 50 seconds, is
0.83 × 18.63 ≈ 15 neurons. With the voice on for every answer, that is about
157 neurons a question, or about 64 a day on the free allowance.

The most one chat request can cost is the 4,000-token input cap plus all 512 output
tokens:

```
input   4,000 × 26,668 / 1,000,000  = 106.7 neurons
output    512 × 204,805 / 1,000,000 = 104.9 neurons
                                      ---------------
worst case per request                211.5 neurons   ($0.0023 on Workers Paid)
```

That holds for ordinary text in any language, which the estimate over-counts. Text crafted
to tokenize badly (long runs of symbols) can cost more per request, which is why the ledger
settles each request to the usage the model reports: the daily budgets hold in real
neurons, give or take the requests already running when one fills up. So one client gets
at most 11 worst-case requests a day (2,500 / 212) before its daily limit, and the relay as
a whole spends at most `DAILY_NEURON_BUDGET`. The most the relay can cost on Workers Paid
is therefore:

```
worst case per day  =  (DAILY_NEURON_BUDGET − 10,000) × $0.011 / 1,000   + the $5 plan a month
DAILY_NEURON_BUDGET = 10,000 (the default)  →  $0 a day
DAILY_NEURON_BUDGET = 150,000               →  $1.54 a day, about $46 a month
```

The estimate behind the budgets runs high (it counts every non-English character as a
whole token), so the real spend is at or below the budget. If Cloudflare's own free
allowance runs out first, the relay answers 503 until 00:00 UTC on the Free plan, as
before.

Example at launch scale: 1,000 questions a day is 141,400 neurons. After the free
10,000, that leaves 131,400 neurons × $0.011 / 1,000 ≈ $1.45 a day, about $43 a month
plus the $5 plan. That needs Workers Paid and `DAILY_NEURON_BUDGET` of about 150,000.
Also set a usage-based billing notification in the dashboard (Notifications) if your
account offers one; the budget is the hard stop either way.

For comparison, `@cf/meta/llama-3.1-8b-instruct-fp8-fast` uses 4,119 and 34,868 neurons
per million tokens. That works out to about 22.8 neurons a question: about 438 free
questions a day, or $0.25 per 1,000. The answers are noticeably weaker.

## 6. What the relay keeps

- Questions, conversations and the text sent for speech are not stored. They pass to
  Workers AI and the reply comes back.
- Workers Logs keeps only the Worker's own `console.log` lines: Workers AI failures, a
  limiter or budget object that failed, and the day the budget ran out. None of them
  contains an address or a question. The per-request invocation log, which would hold
  every caller's IP address and location, is switched off in `wrangler.toml`
  (`invocation_logs = false`; new Workers have it on unless it is turned off). If you
  turn it on, the privacy policy has to say so first.
- The daily ledger stores, per client, only a salted SHA-256 of its rate-limit key, never
  the address. The salt is random and new each day, and at the first request after
  00:00 UTC everything in the ledger, salt included, is deleted.
- `npx wrangler@4 tail` streams live events, IP address included, to your terminal only
  while it runs. Nothing is kept.

## 7. Owner decisions

- Requests with no `Origin` header (anything that isn't a browser) are let through, so
  a script can use the relay within the per-client limits and budgets. Refusing them would
  stop the most naive scripts, but anyone can set an `Origin` header, so it is not
  protection. Real protection would need app attestation (App Attest on iOS, Turnstile on
  the web), which the app doesn't have.
- Raising `DAILY_NEURON_BUDGET` above 10,000 only makes sense on Workers Paid, and sets
  the most the relay can cost a day (section 5).
