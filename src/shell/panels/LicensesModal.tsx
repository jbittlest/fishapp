/* Open-source licences: the notice of every package the app ships (React, Leaflet, zustand,
 * lucide icons, the Barlow fonts…), which their MIT / ISC / BSD / SIL OFL licences require to travel
 * with the software. Generated from node_modules by tools/make-licenses.mjs into
 * src/legal/licenses.json; its own lazy chunk, so About stays light. Works offline. */
import { Button, Disclosure, Group, Modal, ModalPortal } from '../../ui';
import LICENSES from '../../legal/licenses.json';

export interface LicenceEntry { name: string; version: string; license: string; homepage: string | null; text: string }

export default function LicensesModal({ onClose }: { onClose: () => void }) {
  const list = LICENSES as LicenceEntry[];
  return (
    <ModalPortal>
      <Modal title="Open-source licences" onCancel={onClose}>
        <p className="about-para">This app is built with the open-source software below. Each is used under the licence shown; tap one for its full notice.</p>
        <Group className="about-licences">
          {list.map((p) => (
            <Disclosure key={p.name} summary={<span><span className="ui-row__title">{p.name}</span> <span className="ui-sub">{p.version} · {p.license}</span></span>}>
              {p.homepage && <p className="about-para">{p.homepage}</p>}
              <pre className="about-licence">{p.text}</pre>
            </Disclosure>
          ))}
        </Group>
        <Button variant="secondary" block onClick={onClose}>Close</Button>
      </Modal>
    </ModalPortal>
  );
}
