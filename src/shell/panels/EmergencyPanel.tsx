/* Emergency — opened by SOS. Safety copy is kept word-for-word from the legacy app. */
import { useState } from 'react';
import { Button, Group, Hint, Icon, ListRow, Section, Sheet, Spinner, useStoreValue } from '../../ui';
import { gpsStore, formatCoord } from '../../engine/gps.js';
import { readJSON } from '../../engine/app.js';
import { promptDialog, toast } from '../../services/ui';
import { copyText, openExternal } from '../../services/native';

interface Contact { name: string; number: string }
function getContact(): Contact | null { return readJSON('fishapp.emgcontact', null); }

export default function EmergencyPanel() {
  const lat = useStoreValue(gpsStore, (s) => s.lat as number | null);
  const lng = useStoreValue(gpsStore, (s) => s.lng as number | null);
  const [contact, setContact] = useState<Contact | null>(getContact);
  const has = lat != null && lng != null;
  const dm = has ? formatCoord(lat!, 'lat') + '  ' + formatCoord(lng!, 'lon') : null;
  const dec = has ? lat!.toFixed(5) + ', ' + lng!.toFixed(5) : null;

  const copy = async () => {
    if (!has) { toast('No GPS fix yet'); return; }
    toast((await copyText(dec!)) ? 'Coordinates copied' : dec!);
  };
  const text = () => {
    if (!has) { toast('No GPS fix yet — wait for the green dot'); return; }
    const la = lat!.toFixed(5), ln = lng!.toFixed(5);
    const body = '⚠️ HELP - I need assistance. My position: ' + formatCoord(lat!, 'lat') + ' ' + formatCoord(lng!, 'lon') +
      ' (' + la + ', ' + ln + ') https://maps.google.com/?q=' + la + ',' + ln + ' - sent from FishApp';
    const c = getContact();
    openExternal('sms:' + (c ? c.number : '') + '?body=' + encodeURIComponent(body));
  };
  const setNew = async () => {
    const cur = getContact();
    const r = await promptDialog({
      title: 'Emergency contact',
      message: 'Who should “Text my location for help” go to?',
      fields: [
        { name: 'name', label: 'Name', value: cur?.name ?? '', placeholder: 'e.g. Sam' },
        { name: 'number', label: 'Phone number', value: cur?.number ?? '', type: 'tel', inputMode: 'tel', placeholder: 'e.g. 555 123 4567' },
      ],
      confirmLabel: 'Save contact',
    });
    if (!r) return;
    const c = { name: (r.name || '').trim(), number: (r.number || '').replace(/[^\d+]/g, '') };
    try { localStorage.setItem('fishapp.emgcontact', JSON.stringify(c)); } catch { /* ignore */ }
    setContact(c);
    toast('Emergency contact saved');
  };

  return (
    <Sheet title="Emergency">
      <div className="emg-pos">
        <div className="ui-label">Your position — read this to the Coast Guard</div>
        {has ? (
          <>
            <div className="emg-pos__dm">{dm}</div>
            <div className="emg-pos__dec">{dec}</div>
          </>
        ) : <div className="emg-pos__wait"><Spinner size="sm" />Waiting for GPS…</div>}
        <Button icon="copy" compact onClick={copy}>Copy coordinates</Button>
      </div>

      <Section label="Text my position">
        <Button variant="destructive" icon="send" block onClick={text}>Text my location for help</Button>
        <Hint>Opens your Messages app with your live coordinates + a Google Maps link pre-filled — you just hit send. Needs any cell signal (on iPhone 14+, texts can go via satellite).</Hint>
        <div className="emg-contact">
          <Icon name="phone" size={18} />
          <span className="emg-contact__text">{contact ? <>To: <b>{contact.name}</b> ({contact.number})</> : 'No contact saved — the text opens with no recipient so you can pick one.'}</span>
          <Button variant="secondary" compact onClick={setNew}>Set emergency contact</Button>
        </div>
      </Section>

      <Section label="No signal? Satellite SOS">
        <div className="emg-card">
          <p><b>iPhone 14 or newer</b> can call for help with no cell service:</p>
          <ol>
            <li>Try to call <b>911</b> — if there’s no signal it offers <b>Emergency Text via Satellite</b>.</li>
            <li>Or hold the <b>side button + a volume button</b>, then drag <b>Emergency SOS</b>.</li>
            <li>Point the phone at open sky and follow the on-screen arrow to connect.</li>
            <li>Answer the questions — it relays your location to responders.</li>
          </ol>
          <p>Practice free anytime: <b>Settings → Emergency SOS → Try Demo</b>. Some new Android phones (Pixel 9+, Galaxy S24+) have satellite SOS too — check your Safety settings.</p>
        </div>
      </Section>

      <Section label="Call for help">
        <Group>
          <ListRow icon="radio" title="VHF Channel 16" subtitle="Hailing & distress (primary at sea)" />
          <ListRow icon="phone" title="Coast Guard / 911" subtitle="Tap to call 911 (needs cell signal)" chevron onPress={() => openExternal('tel:911')} />
        </Group>
      </Section>

      <Section label="MAYDAY script (life-threatening)">
        <div className="emg-card emg-script">
          “<b>MAYDAY, MAYDAY, MAYDAY.</b><br />
          This is <i>[boat name]</i>, <i>[boat name]</i>, <i>[boat name]</i>.<br />
          <b>MAYDAY</b>, <i>[boat name]</i>.<br />
          My position is <b className="tnum">{has ? formatCoord(lat!, 'lat') + ' ' + formatCoord(lng!, 'lon') : '[coordinates above]'}</b>.<br />
          Nature of emergency: <i>[sinking / fire / medical / man overboard]</i>.<br />
          Number of people on board: <i>[#]</i>.<br />
          We require immediate assistance. <b>Over.</b>”
        </div>
        <Hint>For urgent-but-not-life-threatening issues use <b>PAN-PAN</b> (say it 3×) instead of MAYDAY.</Hint>
      </Section>
    </Sheet>
  );
}
