/* Trolling motor link — the panel (More → Trolling motor).
 *
 * Everything here reads motorStore and calls engine/motor.js directly. The engine owns the
 * safety cage — arm gate, deadman interval, visibilitychange / pagehide STOP — so closing or
 * unmounting this sheet never disarms anything and never stops a timer.
 *
 * Copy for safety, honesty and limitations is the legacy panel's, word for word (emoji removed).
 * Device names and log lines are attacker-controlled (anything broadcasting in radio range):
 * they are only ever rendered as React text. */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Field, Group, Hint, ListRow, Notice, Num, Section, Sheet, Spinner, StateBox, TextInput, useStoreValue } from '../../ui';
import {
  motorStore, motorOnOpen, motorToggleConnect, motorConnect, motorCopyLog, motorToggleArm, motorStop,
  motorSaveUuids, motorSendFrame, motorAddFrame, motorRecordToggle, motorMarkEvent, motorExportSession,
  motorAdoptLegacyStop,
} from '../../engine/motor.js';
import type { MotorLogLine, MotorRichPart } from '../../engine/motor.js';
import { isNativeShell } from '../../services/native';
import './motor.css';

function RichText({ parts }: { parts: MotorRichPart[] }) {
  return <>{parts.map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
}

const TITLE = 'Trolling motor link';

export default function MotorPanel() {
  // Panel open: refresh what's true now and print the browser check (never re-arms anything).
  useEffect(() => { motorOnOpen(); }, []);
  const support = useStoreValue(motorStore, (s) => s.support);

  /* iOS app: no Web Bluetooth and no native bridge. The More sheet hides the tile; if this is
     opened anyway it explains instead of showing controls that cannot work. */
  if (support.reason === 'native' || isNativeShell()) {
    return (
      <Sheet title={TITLE}>
        <Notice icon="bluetooth-off" title="Not available in the iPhone app">
          <RichText parts={support.parts} />
        </Notice>
      </Sheet>
    );
  }

  return (
    <Sheet title={TITLE}>
      {!support.ok && (
        <Notice icon="bluetooth-off" title="Bluetooth isn't available here">
          <RichText parts={support.parts} />
        </Notice>
      )}

      <Hint className="motor-intro">
        Minn Kota publishes no protocol, so this panel ships with no commands in it. It connects,
        shows you everything the motor says, and sends only the byte sequences <b>you</b> captured
        and saved. See <code className="motor-code">MOTOR.md</code> for how to get them.
      </Hint>

      <ConnectionSection supported={support.ok} />
      <SafetySection />
      <ProfileSection />
      <CommandsSection />
      <ReconSection />
    </Sheet>
  );
}

/* ------------------------------------------------------------ 1 · Connection */
function ConnectionSection({ supported }: { supported: boolean }) {
  const connected = useStoreValue(motorStore, (s) => s.connected);
  const connecting = useStoreValue(motorStore, (s) => s.connecting);
  const disconnecting = useStoreValue(motorStore, (s) => s.disconnecting);
  const name = useStoreValue(motorStore, (s) => s.deviceName);

  const status = disconnecting
    ? 'Sending STOP, then disconnecting…'
    : connected ? 'Connected to ' + (name || 'motor')
    : connecting === 'choose' ? 'Waiting for you to pick a device…'
    : connecting === 'link' ? 'Connecting to ' + (name || '(unnamed)') + '…'
    : 'Not connected';

  return (
    <Section label="1 · Connection">
      <Group className="motor-status">
        <ListRow icon={connected ? 'bluetooth' : 'bluetooth-off'} title={status}
          trailing={disconnecting ? <Spinner size="sm" label="Disconnecting" />
            : connected ? <Badge tone="ok">Linked</Badge>
            : connecting ? <Spinner size="sm" label="Connecting" /> : null} />
      </Group>
      <Hint>
        <b>Hold down the PAIR button on the motor&apos;s control head while you tap Connect.</b> The
        motor only broadcasts while that button is held, and it stops after 30 seconds — if it
        isn&apos;t held, there is nothing for the phone to find.
      </Hint>
      <div className="motor-stack">
        {/* Called synchronously inside the click: requestDevice needs the tap. While a disconnect
            waits for its STOP write, every link control is held (the engine refuses them too). */}
        {connected ? (
          <Button variant="secondary" icon="bluetooth-off" block busy={disconnecting} onClick={() => { void motorToggleConnect(); }}>Disconnect</Button>
        ) : connecting === 'link' ? (
          <Button variant="secondary" icon="x" block onClick={() => { void motorToggleConnect(); }}>Cancel connecting</Button>
        ) : (
          /* Not disabled while the chooser is open: if it was lost (it can be, when iOS backgrounds
             the app), a re-tap opens a fresh one. A quick double tap is still ignored by the engine. */
          <Button variant="primary" icon="bluetooth" block disabled={!supported || disconnecting}
            onClick={() => { void motorToggleConnect(); }}>Connect to motor</Button>
        )}
        {connecting === 'choose' && <Hint>No device list on screen? Tap Connect to motor again to reopen it.</Hint>}
        <div className="motor-pair">
          {/* A separate button, not a fallback chained after the filtered attempt: requestDevice
              needs transient activation, and a second call made after an await has lost it. */}
          <Button variant="secondary" icon="search" disabled={!supported || connecting === 'link' || disconnecting}
            onClick={() => { void motorConnect({ all: true }); }}>Show all devices</Button>
          <Button variant="secondary" icon="copy" onClick={() => { void motorCopyLog(); }}>Copy log</Button>
        </div>
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- 2 · Safety */
function SafetySection() {
  const connected = useStoreValue(motorStore, (s) => s.connected);
  const connecting = useStoreValue(motorStore, (s) => s.connecting);
  const disconnecting = useStoreValue(motorStore, (s) => s.disconnecting);
  const armed = useStoreValue(motorStore, (s) => s.armed);
  const left = useStoreValue(motorStore, (s) => s.deadmanRemainingS);
  const hasStop = useStoreValue(motorStore, (s) => s.hasStop);
  const legacyStop = useStoreValue(motorStore, (s) => s.legacyStopLabel);

  /* STOP is reachable whenever it can reach the motor — not only while armed. After a link loss
     while armed and a reconnect, the motor may still be doing what it was last told. */
  const showStopRow = armed || (connected && hasStop);

  return (
    <Section label="2 · Safety">
      {/* Arming is reachable only by a deliberate tap; the engine asks for a confirm first. */}
      <Button variant={armed ? 'destructive' : 'secondary'} block icon={armed ? 'unlock' : 'lock'}
        className={'motor-arm' + (armed ? ' is-armed motor-pulse keep-motion' : '')}
        aria-pressed={armed} disabled={!armed && (!connected || !!connecting || disconnecting)}
        onClick={() => { void motorToggleArm(); }}>
        {armed ? 'ARMED — tap to disarm' : 'Disarmed — tap to arm'}
      </Button>
      {!connected && !armed && <Hint>Connect to the motor to arm the link.</Hint>}

      {showStopRow && (
        <div className={'motor-deadman' + (armed ? '' : ' motor-deadman--idle')} role="group" aria-label={armed ? 'Deadman' : 'Stop'}>
          <span className="motor-deadman__text">
            {armed
              ? <>Auto-stop in <Num value={left} size="row" unit="s" /> without input</>
              : 'Disarmed. STOP still sends your STOP command.'}
            {armed && !hasStop && <span className="motor-deadman__warn">No STOP command — use the foot pedal.</span>}
          </span>
          {hasStop && (
            <Button variant="destructive" icon="stop" className="motor-deadman__stop" onClick={() => motorStop('stop button')}>STOP</Button>
          )}
        </div>
      )}

      {!hasStop && legacyStop != null && (
        <div className="motor-safety-note">
          <Notice tone="alert" icon="alert" title={'"' + legacyStop + '" is no longer sent as STOP'}>
            STOP, auto-stop, leaving the app, disarming and disconnecting while armed now send only a
            command named exactly STOP, so right now they can only disarm the link. If
            &quot;{legacyStop}&quot; is your stop command, use it as STOP.
            <Button variant="secondary" icon="stop" block className="motor-legacy-stop"
              onClick={() => { void motorAdoptLegacyStop(); }}>{'Use "' + legacyStop + '" as STOP'}</Button>
          </Notice>
        </div>
      )}

      <div className="motor-safety-note">
        <Notice icon="alert" title="Best-effort only">
          These interlocks are software in a browser on a phone that can lock, freeze or be killed —
          they are best-effort, not a guarantee. <b>The foot pedal and the real remote are the only
          true kill.</b> Keep a hand near one whenever this is armed.
        </Notice>
      </div>
      <Hint>
        {hasStop
          ? 'STOP sends your command named STOP, then disarms. Auto-stop, leaving the app, disarming and disconnecting while armed send it too. It never needs arming.'
          : 'No command named STOP yet, so auto-stop, leaving the app and disarming can only disarm the link — they cannot stop the motor. Add one named exactly STOP under Commands.'}
      </Hint>
    </Section>
  );
}

/* ------------------------------------------------------- 3 · Protocol profile */
function ProfileSection() {
  const profile = useStoreValue(motorStore, (s) => s.profile);
  // Seeded from storage each time the panel opens (the sheet mounts on open).
  const [svc, setSvc] = useState(profile.service);
  const [tx, setTx] = useState(profile.write);
  const [rx, setRx] = useState(profile.notify);
  const norm = (v: string) => v.trim().toLowerCase();
  const dirty = norm(svc) !== profile.service || norm(tx) !== profile.write || norm(rx) !== profile.notify;

  const save = () => {
    motorSaveUuids({ service: svc, write: tx, notify: rx });
    setSvc(norm(svc)); setTx(norm(tx)); setRx(norm(rx));
  };
  const input = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false, autoComplete: 'off', className: 'motor-mono' } as const;

  return (
    <Section label="3 · Protocol profile">
      <Hint>
        UUIDs from your packet capture. Without the service UUID the browser will not show you any
        of the motor&apos;s characteristics — that is a Web Bluetooth rule, not a bug.
      </Hint>
      <div className="motor-stack">
        <Field label="Service UUID">
          <TextInput {...input} value={svc} onChange={(e) => setSvc(e.target.value)} placeholder="0000xxxx-0000-1000-8000-00805f9b34fb" />
        </Field>
        <Field label="Write characteristic">
          <TextInput {...input} value={tx} onChange={(e) => setTx(e.target.value)} placeholder="commands go here" />
        </Field>
        <Field label="Notify characteristic">
          <TextInput {...input} value={rx} onChange={(e) => setRx(e.target.value)} placeholder="telemetry comes back here" />
        </Field>
        <Button variant="secondary" icon="save" block onClick={save}>Save profile</Button>
      </div>
      {dirty && <Hint>Not saved yet. After saving, reconnect to pick it up.</Hint>}
    </Section>
  );
}

/* --------------------------------------------------------------- 4 · Commands */
function CommandsSection() {
  const frames = useStoreValue(motorStore, (s) => s.profile.frames);
  const stopIndex = useStoreValue(motorStore, (s) => s.stopIndex);
  // The STOP command is sent on the force path (no arming, no confirm), so it is not "danger" here.
  const anyDanger = frames.some((f, i) => f.danger && i !== stopIndex);
  return (
    <Section label="4 · Commands">
      {frames.length === 0 ? (
        <StateBox icon="info">
          No commands yet. Capture the One-Boat Network app talking to the motor (see MOTOR.md),
          then add the frames you decoded here.
        </StateBox>
      ) : (
        <>
          <div className="motor-cmds">
            {/* Every one of these came from your own packet capture — the app ships with none. */}
            {frames.map((f, i) => (i === stopIndex ? (
              <Button key={i} variant="destructive" icon="stop"
                aria-label={f.label + ' (emergency stop, sends without arming)'}
                onClick={() => { void motorSendFrame(i); }}>{f.label}</Button>
            ) : (
              <Button key={i} variant={f.danger ? 'destructive' : 'secondary'} icon={f.danger ? 'alert' : undefined}
                aria-label={f.danger ? f.label + ' (can move the boat)' : f.label}
                onClick={() => { void motorSendFrame(i); }}>{f.label}</Button>
            )))}
          </div>
          {anyDanger && <Hint>Commands with the warning triangle can move the boat: they only send while the link is armed, and ask you first.</Hint>}
        </>
      )}
      <div className="motor-stack">
        <Button variant="secondary" icon="plus" block onClick={() => { void motorAddFrame(); }}>Add captured command</Button>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 5 · Recon */
function ReconSection() {
  const recording = useStoreValue(motorStore, (s) => s.recording);
  const frameCount = useStoreValue(motorStore, (s) => s.frameCount);
  const native = isNativeShell();
  return (
    <Section label="5 · Recon" action={recording ? <Badge tone="signal" icon="record">Recording</Badge> : undefined}>
      <div className="motor-recon">
        <Button variant="secondary" icon={recording ? 'stop' : 'record'} onClick={motorRecordToggle}>
          {recording ? 'Stop recording' : 'Record frames'}
        </Button>
        <Button variant="secondary" icon="star" onClick={() => { void motorMarkEvent(); }}>Mark what I just did</Button>
        <Button variant="secondary" icon={native ? 'share' : 'download'} onClick={() => { void motorExportSession(); }}>Export session</Button>
      </div>
      {frameCount > 0 && <p className="motor-count"><Num value={frameCount} size="row" /> frames captured</p>}
      <MotorLog />
    </Section>
  );
}

const LogLine = memo(function LogLine({ line }: { line: MotorLogLine }) {
  return <span className={'motor-log__line' + (line.cls ? ' motor-log__line--' + line.cls : '')}>{line.t + '  ' + line.line}</span>;
});

/* The recon log: text nodes only, in a monospace scroll box that follows new lines unless you
   have scrolled up to read. aria-live is OFF: role="log" is polite by default, and a notify
   characteristic firing many times a second would drown out the safety toasts in VoiceOver
   (the legacy <pre> was not a live region either). */
function MotorLog() {
  const log = useStoreValue(motorStore, (s) => s.log);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <div ref={ref} className="motor-log" role="log" aria-live="off" aria-label="Motor link log" tabIndex={0}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>
      {log.length === 0
        ? <span className="motor-log__empty">Nothing logged yet.</span>
        : log.map((r) => <LogLine key={r.id} line={r} />)}
    </div>
  );
}
