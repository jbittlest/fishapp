/* First Mate — the assistant chat sheet.
 *
 * Everything it shows lives in the engine's asstStore (engine/assistant.js): the transcript
 * survives this sheet closing, because hands-free voice asks questions with it closed and
 * expects the answer spoken. This component only renders the store, keeps the text draft and
 * the settings form draft, and calls engine functions.
 *
 * Honesty: answers render as plain text (pre-wrap) with **bold** as the only markup — never
 * HTML. The status line says which brain is answering, with a shape-coded dot that survives
 * night mode. Cloud AI asks for consent first (App Store 5.1.2(i)); the switch is in settings. */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from 'react';
import {
  Button, Chip, ChipRow, Field, Group, Hint, Icon, IconButton, Notice, PillButton, Section, Select, Sheet, TextInput,
  ToggleRow, useStoreValue,
} from '../../ui';
import {
  ASST_CHIPS, ASST_CLOUD_DATA, ASST_CONSENT_LATER_NOTE, ASST_CONSENT_TIMEOUT_NOTE, ASST_DECLINED_NOTE, ASST_MODELS, ASST_PROXY,
  asstClearChat, asstNormalizeProxy, asstOnOpen, asstReadSettings, asstSaveSettings,
  asstSend, asstSetCloudConsent, asstSplitBold, asstStartMic, asstStore, asstTestVoice, asstToggleSpeak,
} from '../../engine/assistant.js';
import { isNativeShell } from '../../services/native';
import { confirmDialog } from '../../services/ui';
import './asst.css';

type View = 'chat' | 'settings';

/** Grows the composer to four lines (16px type, 22px line). */
const COMPOSER_MAX_PX = 4 * 22 + 20;

export default function AssistantPanel() {
  const [view, setView] = useState<View>('chat');
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  /* The composer only exists in chat view; its draft lives here so a half-typed question
     survives a trip to settings and back (the legacy input bar stayed in the page). */
  const [draft, setDraft] = useState('');
  const speak = useStoreValue(asstStore, (s) => s.speak);
  const ttsSupported = useStoreValue(asstStore, (s) => s.ttsSupported);
  const cloudVoice = useStoreValue(asstStore, (s) => s.cloudVoice);
  const online = useStoreValue(asstStore, (s) => s.online);
  const consent = useStoreValue(asstStore, (s) => s.consent);

  // The old togglePanel on-open hook: refresh status + voices, greet an empty transcript.
  useEffect(() => { asstOnOpen(); }, []);

  // A switch to settings starts at the top; back to chat lands on the newest message.
  useEffect(() => {
    if (!body) return;
    body.scrollTop = view === 'chat' ? body.scrollHeight : 0;
  }, [view, body]);

  /* Speaking needs a device voice, or the natural cloud voice with signal — which needs cloud
     AI allowed (it sends the text to the relay). Where neither exists the toggle would do
     nothing, so it isn't offered (settings explain why). */
  const canSpeak = ttsSupported || (cloudVoice && online && consent === 'yes');

  const actions = (
    <>
      {canSpeak && (
        <PillButton icon={speak ? 'volume' : 'volume-x'} on={speak} onClick={asstToggleSpeak}
          aria-label="Read answers aloud" title={speak ? 'Voice on — tap to mute' : 'Read answers aloud'}>
          Speak
        </PillButton>
      )}
      <IconButton icon="settings" size="sm" label={view === 'settings' ? 'Back to the chat' : 'First Mate settings'}
        active={view === 'settings'} onClick={() => setView((v) => (v === 'settings' ? 'chat' : 'settings'))} />
    </>
  );

  return (
    <Sheet
      title="First Mate"
      subtitle={<StatusLine />}
      actions={actions}
      footer={view === 'chat' ? <Composer draft={draft} setDraft={setDraft} /> : undefined}
      bodyRef={setBody}
      bodyClassName={view === 'chat' ? 'asst-body' : 'asst-body asst-body--settings'}
    >
      {view === 'chat' ? <Transcript body={body} /> : <SettingsView onDone={() => setView('chat')} />}
    </Sheet>
  );
}

/* ------------------------------------------------------------- status line */
function StatusLine() {
  const brain = useStoreValue(asstStore, (s) => s.brain);
  const text = useStoreValue(asstStore, (s) => s.statusText);
  /* Shape carries the state (night mode is monochrome): filled disc = a cloud AI is
     answering; ring = offline, answering on the phone; diamond = online but answering on the
     phone (cloud AI switched off, or the AI relay unavailable — the text says which). */
  return (
    <span className={'asst-status is-' + brain} role="status">
      <span className="asst-status__dot" aria-hidden />
      <span className="asst-status__text">{text || 'Checking connection…'}</span>
    </span>
  );
}

/* -------------------------------------------------------------- transcript */
function Transcript({ body }: { body: HTMLDivElement | null }) {
  const messages = useStoreValue(asstStore, (s) => s.messages);
  const busy = useStoreValue(asstStore, (s) => s.busy);
  const lastCount = useRef(0);
  /* Was the reader at the bottom BEFORE the latest update? Measured on scroll, because after a
     long answer lands the content has already grown past any "near the bottom" threshold. */
  const following = useRef(true);
  /* The last answer already positioned (null until the first render has run). */
  const settled = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (!body) return;
    const onScroll = () => { following.current = body.scrollHeight - body.scrollTop - body.clientHeight < 120; };
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [body]);

  /* Follow the conversation: always jump to a NEW message; for progress updates on the one
     in flight, only if the reader hasn't scrolled up to read something older. When the answer
     lands, show it from its question down: to the bottom if it all fits, otherwise with the
     question pinned at the top so the answer reads from its first line. */
  useLayoutEffect(() => {
    if (!body) return;
    const grew = messages.length !== lastCount.current;
    lastCount.current = messages.length;
    const last = messages[messages.length - 1];
    const answer = last && last.role === 'bot' && !last.thinking && !last.greeting ? last.id : null;
    const first = settled.current === undefined;
    const landed = !first && answer != null && answer !== settled.current;
    if (answer != null || first) settled.current = answer;
    const bottom = body.scrollHeight - body.clientHeight;
    if (landed && (grew || following.current)) {
      const q = [...messages].reverse().find((m) => m.role === 'user');
      const el = body.querySelector<HTMLElement>(`[data-mid="${q ? q.id : answer}"]`);
      const top = el ? el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 12 : bottom;
      body.scrollTop = Math.min(Math.max(0, top), bottom);
      following.current = top >= bottom;
    } else if (grew || following.current) {
      body.scrollTop = body.scrollHeight;
      following.current = true;     // the scroll event that would say so arrives after the next update
    }
  }, [messages, body]);

  const last = messages[messages.length - 1];
  // "Try again" re-asks the question that the failed answer belongs to.
  const retryText = !busy && last && last.role === 'bot' && last.error
    ? [...messages].reverse().find((m) => m.role === 'user')?.text ?? null
    : null;

  return (
    <div className="asst-log" role="log" aria-live="polite" aria-label="Conversation with First Mate">
      {messages.map((m) => (
        m.role === 'user' ? (
          <div key={m.id} data-mid={m.id} className="asst-msg asst-msg--user">{m.text}</div>
        ) : m.thinking ? (
          <div key={m.id} data-mid={m.id} className="asst-msg asst-msg--bot asst-thinking" aria-label="First Mate is working on it">
            <span className="asst-dots" aria-hidden><i /><i /><i /></span>
            <span>{m.progress ? capitalize(m.progress) + '…' : 'Thinking…'}</span>
          </div>
        ) : m.error ? (
          <div key={m.id} data-mid={m.id} className="asst-msg asst-msg--bot is-error">
            <Icon name="cloud-off" size={18} className="asst-msg__icon" />
            <div className="asst-msg__text"><RichText text={m.text} /></div>
          </div>
        ) : (
          <div key={m.id} data-mid={m.id} className={'asst-msg asst-msg--bot' + (m.greeting ? ' is-greeting' : '')}>
            <RichText text={m.text} lead={!!m.greeting} />
          </div>
        )
      ))}
      {retryText && (
        <div className="asst-retry">
          {/* Full-size (48px) — the one most likely to be tapped with a wet thumb. */}
          <Button variant="ghost" icon="refresh" onClick={() => { void asstSend(retryText); }}>Try again</Button>
        </div>
      )}
    </div>
  );
}

interface Run { text: string; bold: boolean }
/* The "answered on this phone" notes the engine appends after a blank line: shown as a quiet
   footnote (same words), so they never read as part of the answer. */
const NOTES: ReadonlySet<string> = new Set([ASST_DECLINED_NOTE, ASST_CONSENT_LATER_NOTE, ASST_CONSENT_TIMEOUT_NOTE]);
/* A list line: "• ", "- ", "* " or "1. " / "1) " — rendered with a hanging indent so wrapped
   lines sit under the text, not under the bullet. Numbers are kept; "-" and "*" markers are
   typeset as the same bullet as "•". */
const LIST_RE = /^([ \t]*(?:[•\-*]|\d{1,2}[.)]))[ \t]+/;

/** Split the bold runs into lines (a bold run may span a line break). */
function toLines(parts: Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const p of parts) {
    p.text.split('\n').forEach((seg, i) => {
      if (i > 0) lines.push([]);
      if (seg) lines[lines.length - 1].push({ text: seg, bold: p.bold });
    });
  }
  return lines;
}

function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}</>;
}

/** Plain text with **bold** runs — the only markup a reply may carry. React escapes the rest.
 *  Layout only: each line is a block (blank lines become a paragraph gap), list lines get a
 *  hanging indent; the words are exactly the reply's. */
function RichText({ text, lead }: { text: string; lead?: boolean }) {
  const lines = useMemo(() => toLines(asstSplitBold(text) as Run[]), [text]);
  return (
    <>
      {lines.map((runs, i) => {
        if (!runs.length) return <span key={i} className="asst-gapline" aria-hidden />;
        const whole = runs.map((r) => r.text).join('');
        if (NOTES.has(whole.trim())) return <span key={i} className="asst-line asst-note">{whole}</span>;
        const m = !runs[0].bold ? LIST_RE.exec(runs[0].text) : null;
        if (m) {
          const rest = [{ text: runs[0].text.slice(m[0].length), bold: false }, ...runs.slice(1)];
          return (
            <span key={i} className="asst-line asst-li">
              <span className="asst-li__m" aria-hidden={/^[-*•]$/.test(m[1].trim()) || undefined}>
                {/^[-*]$/.test(m[1].trim()) ? '•' : m[1].trim()}
              </span>
              <span className="asst-li__t"><Runs runs={rest} /></span>
            </span>
          );
        }
        return <span key={i} className={'asst-line' + (lead && i === 0 ? ' asst-line--lead' : '')}><Runs runs={runs} /></span>;
      })}
    </>
  );
}

function capitalize(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/* ---------------------------------------------------------------- composer */
function Composer({ draft, setDraft }: { draft: string; setDraft: (v: string) => void }) {
  const busy = useStoreValue(asstStore, (s) => s.busy);
  const showChips = useStoreValue(asstStore, (s) => s.showChips);
  const micSupported = useStoreValue(asstStore, (s) => s.micSupported);
  const micListening = useStoreValue(asstStore, (s) => s.micListening);
  const ta = useRef<HTMLTextAreaElement>(null);
  const hasText = draft.trim().length > 0;
  /* Which ends of the suggestion row are scrolled away — the fade only shows where more chips are. */
  const [chipEdge, setChipEdge] = useState({ start: true, end: false });
  const chipWrap = useRef<HTMLDivElement>(null);
  const measureChips = useCallback((el: HTMLElement | null | undefined) => {
    if (!el) return;
    const start = el.scrollLeft <= 2;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    setChipEdge((p) => (p.start === start && p.end === end ? p : { start, end }));
  }, []);
  useLayoutEffect(() => { measureChips(chipWrap.current?.querySelector<HTMLElement>('.ui-chiprow')); }, [showChips, measureChips]);
  const onChipScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains('ui-chiprow')) measureChips(el);
  };

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    /* Empty: the CSS single-line height. Measuring would size it to the placeholder, which can
       wrap on a narrow phone and make an empty composer two lines tall. */
    el.style.height = '';
    if (!draft) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, COMPOSER_MAX_PX) + 'px';
  }, [draft]);

  /* A send while a reply is in flight is dropped by the engine; keep the draft rather than
     wiping what was typed (the button is disabled meanwhile anyway). */
  const send = useCallback((text: string) => {
    if (busy || !text.trim()) return;
    setDraft('');
    void asstSend(text);
  }, [busy, setDraft]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); }
  };

  return (
    <div className="asst-composer">
      {showChips && (
        <div ref={chipWrap} onScrollCapture={onChipScroll}
          className={'asst-chips-wrap' + (chipEdge.start ? ' is-start' : '') + (chipEdge.end ? ' is-end' : '')}>
          <ChipRow className="asst-chips">
            {ASST_CHIPS.map((c: string) => <Chip key={c} onPress={() => { if (!busy) void asstSend(c); }}>{c}</Chip>)}
          </ChipRow>
        </div>
      )}
      <div className="asst-bar">
        {micSupported && (
          /* SpeechRecognition.start() runs synchronously inside this tap (iOS needs the gesture). */
          <IconButton icon="mic" label={micListening ? 'Listening — tap when done' : 'Speak your question'}
            tone={micListening ? 'signal' : 'default'} active={micListening} className={'asst-bar__mic' + (micListening ? ' is-listening' : '')}
            onClick={asstStartMic} />
        )}
        <textarea
          ref={ta}
          className="ui-input asst-bar__input"
          rows={1}
          value={draft}
          placeholder="Ask about tides, wind, fish…"
          aria-label="Ask First Mate"
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <IconButton icon="send" label="Send" tone={hasText && !busy ? 'signal' : 'default'} active={hasText && !busy}
          disabled={busy || !hasText} className="asst-bar__send" onClick={() => send(draft)} />
      </div>
      <p className="asst-caption">AI answers can be wrong; never rely on them for safety.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */
function SettingsView({ onDone }: { onDone: () => void }) {
  const init = useMemo(() => asstReadSettings(), []);
  const [key, setKey] = useState<string>(init.key);
  const [model, setModel] = useState<string>(init.model);
  const [proxy, setProxy] = useState<string>(init.proxy);
  const [cloudVoice, setCloudVoice] = useState<boolean>(init.cloudVoice);
  const consent = useStoreValue(asstStore, (s) => s.consent);
  const voices = useStoreValue(asstStore, (s) => s.voices);
  const activeVoice = useStoreValue(asstStore, (s) => s.voiceName);
  const voiceHint = useStoreValue(asstStore, (s) => s.voiceHint);
  const ttsSupported = useStoreValue(asstStore, (s) => s.ttsSupported);
  const online = useStoreValue(asstStore, (s) => s.online);
  const [voiceName, setVoiceName] = useState<string>(init.voiceName || activeVoice);
  const native = isNativeShell();

  // The voice list can arrive after this opens (iOS fills it asynchronously).
  useEffect(() => { if (!voiceName && activeVoice) setVoiceName(activeVoice); }, [activeVoice, voiceName]);

  const proxyCheck = asstNormalizeProxy(proxy);
  /* The natural cloud voice sends spoken text to the relay, so it needs cloud AI ALLOWED —
     not merely "not refused" (consent null = never asked). */
  const cloudOff = consent !== 'yes';
  const cloudVoiceUsable = cloudVoice && !cloudOff && online;
  const canTest = ttsSupported || cloudVoiceUsable;
  // A saved voice this device no longer has falls back to the one actually in use.
  const voiceValue = voices.some((v: { name: string }) => v.name === voiceName) ? voiceName : (activeVoice || voices[0]?.name || '');

  const save = () => {
    if (proxyCheck.error) return;
    if (asstSaveSettings({ key, model, proxy, cloudVoice, voiceName: voiceValue })) onDone();
  };
  const clear = async () => {
    const ok = await confirmDialog({
      title: 'Clear the chat?',
      message: 'This empties the conversation on this phone. Your spots, catches and settings stay.',
      confirmLabel: 'Clear chat',
      destructive: true,
    });
    if (!ok) return;
    asstClearChat();
    onDone();
  };

  return (
    <div className="asst-settings">
      <Section label="Cloud AI">
        <Group>
          <ToggleRow icon={cloudOff ? 'cloud-off' : 'cloud'} title="Allow cloud AI"
            detail={consent === 'yes' ? 'On — with signal, answers come from cloud AI'
              : consent === 'no' ? 'Off — answers come from this phone only'
                : 'First Mate will ask before the first cloud answer'}
            checked={consent === 'yes'} onChange={(v) => asstSetCloudConsent(v)} />
        </Group>
        <Hint>
          When on, First Mate sends {ASST_CLOUD_DATA} to the FishApp AI relay (Cloudflare Workers AI) — or straight to
          Anthropic if you add your own API key. FishApp doesn’t store it. When off, First Mate answers on this phone from
          your boat data.
        </Hint>
      </Section>

      <Section label="Your Anthropic key (optional)">
        <Field label="Anthropic API key" hint="Stored only on this device. Sent only to Anthropic.">
          {/* Explicit (TextInput defaults to the same) so the key never meets AutoFill or autocorrect. */}
          <TextInput type="password" value={key} placeholder="sk-ant-…" autoComplete="off" autoCorrect="off"
            autoCapitalize="off" spellCheck={false} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Online brain (with a key)">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            {ASST_MODELS.map((m: { id: string; label: string; detail: string }) => (
              <option key={m.id} value={m.id}>{m.label} — {m.detail}</option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section label="Voice">
        <Group>
          <ToggleRow icon="volume" title="Natural cloud voice" checked={cloudVoice && !cloudOff} disabled={cloudOff}
            onChange={setCloudVoice}
            detail={cloudOff ? 'Turn on Allow cloud AI above to use it'
              : 'Needs signal; falls back to the phone voice offline. Sends each answer’s text to the FishApp relay.'} />
        </Group>
        <div className="asst-gap" />
        {ttsSupported ? (
          <Field label="Phone voice" hint="Used offline, and if the cloud voice is off">
            <Select value={voiceValue} disabled={!voices.length} onChange={(e) => setVoiceName(e.target.value)}>
              {voices.length
                ? voices.map((v: { name: string; natural: boolean }) => (
                  <option key={v.name} value={v.name}>{v.name}{v.natural ? ' — natural' : ''}</option>
                ))
                : <option value="">No voices found on this device</option>}
            </Select>
          </Field>
        ) : (
          <Notice title="No phone voice">
            This device doesn’t offer a built-in speech voice to the app, so First Mate can only read answers aloud with
            the natural cloud voice, which needs signal.
          </Notice>
        )}
        <Button icon="play" disabled={!canTest} onClick={() => asstTestVoice(voiceValue, cloudVoice && !cloudOff)}>
          This is how I sound
        </Button>
        {ttsSupported && <VoiceHint kind={voiceHint} current={activeVoice} native={native} />}
      </Section>

      <Section label="Free-AI endpoint">
        <Field label="Endpoint" className={proxyCheck.error ? 'asst-field--error' : undefined} hint={proxyCheck.error ?? (proxyCheck.value
          ? 'Your own relay.'
          : 'The FishApp relay — no key needed. Change it only if you run your own.')}>
          <TextInput type="url" inputMode="url" value={proxy} placeholder={ASST_PROXY} autoComplete="off" autoCorrect="off"
            autoCapitalize="off" spellCheck={false} aria-invalid={proxyCheck.error ? true : undefined} onChange={(e) => setProxy(e.target.value)} />
        </Field>
        {proxyCheck.value && (
          <Button variant="ghost" icon="undo" onClick={() => setProxy(ASST_PROXY)}>Use the FishApp relay</Button>
        )}
        <Hint>To stop sending questions anywhere, turn off Allow cloud AI above — emptying this field doesn’t.</Hint>
      </Section>

      <div className="asst-actions">
        <Button variant="primary" block icon="check" disabled={!!proxyCheck.error} onClick={save}>Save</Button>
        <Button variant="secondary" block icon="trash" onClick={() => { void clear(); }}>Clear chat</Button>
      </div>

      <Hint>
        No key needed to start: offline, First Mate answers from your live boat data — position, tides/solunar, cached
        weather, catches, reefs, regs &amp; knots. Add a key (from console.anthropic.com) and it becomes a full
        conversational AI whenever you have signal.
      </Hint>
      <p className="asst-caption asst-caption--settings">AI answers can be wrong; never rely on them for safety.</p>
    </div>
  );
}

/* The honest platform note under the voice picker (legacy copy, emoji removed). */
function VoiceHint({ kind, current, native }: { kind: string; current: string; native: boolean }) {
  if (kind === 'none') return <Hint>This device reports no speech voices yet — reopen this panel in a moment.</Hint>;
  if (kind === 'natural') return <Hint>Using <b>{current}</b> — this is a natural voice.</Hint>;
  if (kind === 'pick-natural') return <Hint>Using <b>{current}</b> — pick one marked natural above for a natural voice.</Hint>;
  if (kind === 'ios') {
    return native ? (
      <Hint>
        Using <b>{current}</b>. On iPhone these built-in voices are the only ones this app can use — the natural
        “Enhanced” voices you can download in iOS Settings aren’t available to it, so downloading one will not change
        this. Try the other options above; they vary in how robotic they sound.
      </Hint>
    ) : (
      <Hint>
        Using <b>{current}</b>. On iPhone these built-in web voices are the only ones available — Safari does not let web
        apps use the natural “Enhanced” voices you can download in iOS Settings, so downloading one will not change this.
        Try the other options above; they vary in how robotic they sound.
      </Hint>
    );
  }
  return (
    <Hint>
      Using <b>{current}</b>. No natural (Enhanced/Premium) voice is installed on this device — installing one at the
      system level will let it appear here.
    </Hint>
  );
}
