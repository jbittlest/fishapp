/* First-run acknowledgement. FishApp is a navigation AID: the depth colouring, forecasts, tides
 * and AI answers come from public data and can be wrong or late. Saying so plainly, once, before
 * anyone relies on it underway is both the right thing to do and what App Review expects of a
 * navigation app (guideline 1.4.1). Also states the privacy basics up front. */
import { useState } from 'react';
import { Button, Icon } from '../ui';
import { openPanel } from '../services/ui';

const KEY = 'fishapp.ack';
const VERSION = 'v1';

function acked(): boolean {
  try { return localStorage.getItem(KEY) === VERSION; } catch { return false; }
}

export function Onboarding() {
  const [show, setShow] = useState(() => !acked());
  if (!show) return null;
  const accept = () => {
    try { localStorage.setItem(KEY, VERSION); } catch { /* private mode: ask again next time */ }
    setShow(false);
  };
  return (
    <div className="shell-onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
      <div className="shell-onboard__card surface-paper">
        <div className="shell-onboard__mark" aria-hidden><Icon name="hull" size={28} /></div>
        <h1 id="onboard-title" className="ui-title-1">Before you head out</h1>
        <ul className="shell-onboard__list">
          <li><Icon name="compass" size={20} /><span><b>FishApp is a navigation aid.</b> It does not replace official NOAA charts, a depth sounder, a VHF radio or a proper lookout.</span></li>
          <li><Icon name="alert" size={20} /><span><b>Data can be wrong or late.</b> Charts, depths, forecasts, tides and First Mate&apos;s answers come from public sources and AI. Cross-check anything you rely on.</span></li>
          <li><Icon name="lock" size={20} /><span><b>Your data stays on this device.</b> Spots, tracks, catches and settings never leave your phone. Your location is used to show your position and to fetch conditions where you are.</span></li>
        </ul>
        <Button variant="primary" block onClick={accept}>I understand</Button>
        <button type="button" className="shell-onboard__link" onClick={() => { accept(); openPanel('about'); }}>Read the privacy policy and data sources</button>
      </div>
    </div>
  );
}
