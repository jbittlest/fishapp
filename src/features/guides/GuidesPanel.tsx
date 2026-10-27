/* Guides — fishing knots with illustrated steps, and fish ID & limits. Fully offline, static data.
 *
 * Opened from More → Guides, by voice ("knots", "fish id", "limits"), or by anything that passes
 * panelData {tab:'fish'|'knots'}. The selected tab and the expanded rows live in a session store
 * (guidesState.ts) so they survive closing and reopening the panel, as the legacy panel did.
 *
 * Copy is the legacy app's, word-for-word apart from emoji. The CDFW disclaimer stays FIRST on the
 * Fish & limits tab and is never collapsed; the official link opens outside the app. */
import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from 'react';
import { Button, Disclosure, Group, Hint, Icon, Notice, Num, Section, Segmented, Sheet, useStoreValue, type IconName } from '../../ui';
import { toast, useUi } from '../../services/ui';
import { isNativeShell, openExternal } from '../../services/native';
import { KNOTS, knotFrames } from '../../engine/knots.js';
import { CDFW_URL, FISH_ID, FISH_REG_WARN, FISH_REGS_AS_OF_TEXT } from '../../engine/fish-id.js';
import { guidesStore, isGuidesTab, setGuideOpen, setGuidesTab, type GuidesTab } from './guidesState';
import { FISH_SECTIONS, KNOT_SECTIONS, noteIsLegal } from './guidesLists';
import './guides.css';

type Knot = (typeof KNOTS)[number];
type Fish = (typeof FISH_ID)[number];
interface Frame { svg: string; cap: string }

/* Long lists group into labelled groups of at most 8 rows (DESIGN.md §4) — see guidesLists.ts. */

/* Open the official CDFW page OUTSIDE the app, never in place of it — anchor watch, Go-To, the
 * track recorder and the hands-free mic all live in this page, and offshore the replacement would
 * be a browser error page.
 *   iOS app: openExternal hands the URL to Safari (NativeBridge "openURL").
 *   Web / PWA: a new tab, with the opener cut. Not openExternal here: on the web it passes
 *   "noopener" to window.open, which per the HTML spec always returns null, so its "popup blocked"
 *   fallback then sent the app itself to wildlife.ca.gov (docs/requests/voice-guides.md §5). */
function openRegs(): void {
  if (isNativeShell()) { openExternal(CDFW_URL); return; }
  let w: Window | null = null;
  try { w = window.open(CDFW_URL, '_blank'); } catch { w = null; }
  if (w) { try { w.opener = null; } catch { /* already cross-origin */ } return; }
  toast('Could not open a new tab. The official regulations are at wildlife.ca.gov');
}
/* The inline link is a real link on the web (the browser opens a new tab itself, exactly like the
 * legacy <a target=_blank rel=noopener>); in the iOS app a target=_blank link does nothing in the
 * web view, so the tap is handed to Safari instead. */
function onRegsLink(e: MouseEvent<HTMLAnchorElement>): void {
  if (!isNativeShell()) return;
  e.preventDefault();
  openExternal(CDFW_URL);
}

function RowSummary({ icon, title, sub, anchor }: { icon: IconName; title: string; sub: string; anchor?: RefObject<HTMLSpanElement | null> }) {
  return (
    <span className="guide-sum" ref={anchor}>
      <span className="guide-sum__lead"><Icon name={icon} size={20} /></span>
      <span className="guide-sum__main">
        <span className="guide-sum__title">{title}</span>
        <span className="guide-sum__sub">{sub}</span>
      </span>
    </span>
  );
}

/* After a row opens, bring what it revealed into view: the whole row when it fits, otherwise its
 * header at the top. The sheet body's scroll-padding (guides.css) keeps it clear of the floating
 * tab bar. Layout only — nothing about the row's state changes. */
function revealRow(anchor: RefObject<HTMLSpanElement | null>): void {
  requestAnimationFrame(() => {
    const row = anchor.current?.closest('.ui-disc');
    if (!row) return;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  });
}

function Tip({ children, legal }: { children: string; legal?: boolean }) {
  return (
    <p className={'guide-tip' + (legal ? ' guide-tip--legal' : '')}>
      <Icon name={legal ? 'alert' : 'info'} size={16} />
      <span>{children}</span>
    </p>
  );
}

/* "5–7 times" must not break after the dash in a narrow caption column: word joiners (invisible,
 * zero-width) hold a number range together. Display only — the caption text is unchanged. */
function keepRanges(text: string): string {
  return text.replace(/(\d)([\u2013-])(\d)/g, '$1\u2060$2\u2060$3');
}

/* KnotArt is static, app-authored SVG (engine/knot-diagrams.js) — never user text — so it is
 * injected as-is; guides.css recolours its strokes to the theme (day / sun / night). */
function KnotFrames({ frames }: { frames: Frame[] }) {
  return (
    <ol className="guide-frames">
      {frames.map((f, n) => (
        <li className="guide-frame" key={n}>
          <div className="guide-art" role="img" aria-label={`Step ${n + 1} diagram`} dangerouslySetInnerHTML={{ __html: f.svg }} />
          <p className="guide-cap">
            <span className="guide-cap__n"><Num value={n + 1} size="row" /></span>
            <span>{keepRanges(f.cap)}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}

function KnotRow({ k }: { k: Knot }) {
  const open = useStoreValue(guidesStore, (s) => s.openKnots.includes(k.name));
  const frames = knotFrames(k) as Frame[] | null;
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <Disclosure open={open} onToggle={(o) => { setGuideOpen('openKnots', k.name, o); if (o) revealRow(anchor); }} className="guide-row"
      summary={<RowSummary icon="knot" title={k.name} sub={k.use} anchor={anchor} />}>
      <p className="guide-level">{k.level}</p>
      {frames ? <KnotFrames frames={frames} /> : (
        <ol className="guide-steps">{k.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
      )}
      {k.tip && <Tip>{k.tip}</Tip>}
    </Disclosure>
  );
}

function KnotsTab() {
  return (
    <>
      <Hint className="guide-intro">Tap a knot for illustrated steps.</Hint>
      <div className="guide-legend" aria-label="Diagram key">
        <span className="guide-legend__item"><svg viewBox="0 0 24 8" aria-hidden><path className="guide-sw guide-sw--line" d="M2 4 H22" /></svg>Standing line</span>
        <span className="guide-legend__item"><svg viewBox="0 0 24 8" aria-hidden><path className="guide-sw guide-sw--tag" d="M2 4 H22" /></svg>Tag end</span>
        <span className="guide-legend__item"><svg viewBox="0 0 24 8" aria-hidden><path className="guide-sw guide-sw--eye" d="M2 4 H22" /></svg>Hook eye or spool</span>
      </div>
      {KNOT_SECTIONS.map((g) => (
        <Section key={g.key} label={g.label}>
          <Group>{g.items.map((k) => <KnotRow key={k.name} k={k} />)}</Group>
        </Section>
      ))}
    </>
  );
}

function FishRow({ f }: { f: Fish }) {
  const open = useStoreValue(guidesStore, (s) => s.openFish.includes(f.name));
  const anchor = useRef<HTMLSpanElement>(null);
  return (
    <Disclosure open={open} onToggle={(o) => { setGuideOpen('openFish', f.name, o); if (o) revealRow(anchor); }} className="guide-row"
      summary={<RowSummary icon="fish" title={f.name} sub={f.size + ' · ' + f.bag} anchor={anchor} />}>
      <p className="guide-id">{f.id}</p>
      <dl className="guide-facts">
        <div className="guide-facts__cell"><dt className="ui-label">Min size</dt><dd>{f.size}</dd></div>
        <div className="guide-facts__cell"><dt className="ui-label">Bag limit</dt><dd>{f.bag}</dd></div>
      </dl>
      <p className="ui-caption guide-asof">{FISH_REGS_AS_OF_TEXT}</p>
      {f.note && <Tip legal={noteIsLegal(f.note)}>{f.note}</Tip>}
    </Disclosure>
  );
}

function RegsNotice() {
  return (
    <Notice icon="alert" title="General reference only">
      {FISH_REG_WARN.before}
      <a className="guide-link" href={CDFW_URL} target="_blank" rel="noopener noreferrer" onClick={onRegsLink}>{FISH_REG_WARN.link}</a>
      {FISH_REG_WARN.after}
      <span className="guide-asof"> {FISH_REGS_AS_OF_TEXT}</span>
      <span className="guide-regs-btn">
        <Button icon="external" onClick={openRegs}>Official CDFW regulations</Button>
      </span>
    </Notice>
  );
}

function FishTab() {
  return (
    <>
      <RegsNotice />
      {FISH_SECTIONS.map((g) => (
        <Section key={g.key} label={g.label}>
          <Group>{g.items.map((f) => <FishRow key={f.name} f={f} />)}</Group>
        </Section>
      ))}
    </>
  );
}

export default function GuidesPanel() {
  const tab = useStoreValue(guidesStore, (s) => s.tab);
  const panelData = useUi((s) => s.panelData);

  // panelData {tab:'fish'} (voice "fish id" / "limits", First Mate) selects that tab. Keyed on the
  // payload object, so asking again after switching tabs by hand still switches back. A layout
  // effect, so the switch lands before the first paint: an effect showed the last-used tab
  // (Knots) for a frame and the CDFW disclaimer arrived late with a visible flash.
  useLayoutEffect(() => {
    const want = panelData && typeof panelData === 'object' ? (panelData as { tab?: unknown }).tab : undefined;
    if (isGuidesTab(want)) setGuidesTab(want);
  }, [panelData]);

  return (
    <Sheet title="Guides" subtitle="Works offline" bodyClassName="guide-body">
      <Segmented<GuidesTab> label="Guide" value={tab} onChange={setGuidesTab} className="guide-seg"
        options={[{ value: 'knots', label: 'Knots' }, { value: 'fish', label: 'Fish & limits' }]} />
      <div role="tabpanel" aria-label={tab === 'knots' ? 'Knots' : 'Fish & limits'}>
        {tab === 'knots' ? <KnotsTab /> : <FishTab />}
      </div>
    </Sheet>
  );
}
