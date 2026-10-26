/* MotorBand — persistent layer, under the HUD, never covered by a sheet. Visible only while the
 * motor link is ARMED, so a live propeller link can't be forgotten behind a closed panel or
 * another sheet: the deadman countdown and a full-size STOP are always one tap away.
 * The countdown and auto-stop themselves run in engine/motor.js; this only reads motorStore.
 *
 * Honesty (DESIGN principle 7): with no command named STOP the app can only disarm its own link —
 * the motor keeps doing what it was last told. The band then never says "STOP": the button reads
 * "Disarm", and the band says to use the foot pedal (naming a command the old "contains stop"
 * rule used to send, if the profile has one). */
import { Button, Icon, Num, useStoreValue } from '../../ui';
import { motorStore, motorStop } from '../../engine/motor.js';
import { openPanel } from '../../services/ui';
import './motor.css';

export function MotorBand() {
  const armed = useStoreValue(motorStore, (s) => s.armed);
  const left = useStoreValue(motorStore, (s) => s.deadmanRemainingS);
  const hasStop = useStoreValue(motorStore, (s) => s.hasStop);
  const legacyStop = useStoreValue(motorStore, (s) => s.legacyStopLabel);
  if (!armed) return null;
  return (
    <div className="motor-band motor-pulse keep-motion" role="group" aria-label="Trolling motor armed">
      <button type="button" className="motor-band__info" onClick={() => openPanel('motor')}>
        <span className="motor-band__icon"><Icon name="propeller" size={20} /></span>
        <span className="motor-band__text">
          <b>Motor armed</b> · auto-stop in <Num value={left} size="row" unit="s" />
          {!hasStop && (
            <span className="motor-band__warn">
              {legacyStop != null
                ? '"' + legacyStop + '" is no longer sent as STOP. Use the foot pedal.'
                : 'No STOP command. Use the foot pedal.'}
            </span>
          )}
        </span>
      </button>
      {hasStop ? (
        <Button variant="destructive" icon="stop" className="motor-band__stop motor-stopglyph" onClick={() => motorStop('stop button')}>STOP</Button>
      ) : (
        <Button variant="destructive" icon="lock" className="motor-band__stop" onClick={() => motorStop('user')}>Disarm</Button>
      )}
    </div>
  );
}
