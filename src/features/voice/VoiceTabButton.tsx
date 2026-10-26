/* The centre tab item: "Hey Fish" hands-free voice.
 *
 * Renders voiceStore only; the engine (engine/voice.js) owns the mic session, the restart loop,
 * the echo guard and every timer. voiceToggle() is called SYNCHRONOUSLY inside onClick: that tap
 * is the iOS user gesture that unlocks the mic, speech and the anchor-alarm sound — calling it
 * from an effect or after an await would lose the unlock.
 *
 * The shell only renders this when voiceStore.supported is true (otherwise the centre slot is
 * First Mate), so it never shows a mic that cannot work.
 *
 * States (shell.css styles the shell-tab--voice modifiers):
 *   is-off        hands-free off (or waiting to resume / restarting) — muted disc
 *   is-listening  the mic is live, waiting for "Hey Fish" — signal disc with pulse rings
 *   is-awake      wake word heard, 9 s command window — inverted disc, still pulsing
 * The label reads "Hey Fish", "Listening", "Starting", or for 2 s the command it just heard. */
import { Icon, useStoreValue } from '../../ui';
import { voiceStore, voiceToggle } from '../../engine/voice.js';
import './voice.css';

export function VoiceTabButton() {
  const on = useStoreValue(voiceStore, (s) => s.on);
  const listening = useStoreValue(voiceStore, (s) => s.listening);
  const awake = useStoreValue(voiceStore, (s) => s.awake);
  const resumePending = useStoreValue(voiceStore, (s) => s.resumePending);
  const label = useStoreValue(voiceStore, (s) => s.label);
  const heard = useStoreValue(voiceStore, (s) => s.transcript);

  const state = awake && listening ? 'is-listening is-awake' : listening ? 'is-listening' : 'is-off';
  const aria = awake
    ? 'Hey Fish heard — say your command. Tap to turn hands-free off'
    : listening
      ? 'Hands-free voice is listening for “Hey Fish”. Tap to turn it off'
      : on
        ? 'Hands-free voice is starting. Tap to turn it off'
        : resumePending
          ? 'Hands-free voice was on — tap anywhere to resume it'
          : 'Hey Fish hands-free voice. Tap to start listening';

  return (
    <button type="button" id="btn-voice" data-voice-toggle=""
      className={'shell-tab shell-tab--voice voice-tab ' + state + (heard ? ' voice-tab--heard' : '')}
      aria-pressed={on} aria-label={aria} title={aria}
      onClick={() => voiceToggle()}>
      <span className="shell-tab__disc"><Icon name="mic" size={22} /></span>
      <span className="shell-tab__label voice-tab__label">{label}</span>
      {resumePending && <span className="voice-tab__resume" aria-hidden />}
    </button>
  );
}
