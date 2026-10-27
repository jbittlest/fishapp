/* About — version, the not-for-navigation statement, the privacy policy (in full, offline) and
 * data-source credits. App Review requires the privacy policy to be reachable inside the app. */
import { lazy, Suspense, useState } from 'react';
import { Disclosure, Group, Icon, ListRow, Notice, Section, Sheet } from '../../ui';
import { useUi } from '../../services/ui';
import { openExternal, isNativeShell } from '../../services/native';
import { appStoreReviewUrl } from '../../services/review';
import { SITE } from '../../services/site';
import { NOT_FOR_NAVIGATION, POLICY, POLICY_UPDATED, SOURCES, SUPPORT_URL } from '../../legal/privacy.js';

const LicensesModal = lazy(() => import('./LicensesModal'));

export default function AboutPanel() {
  const build = useUi((s) => s.build);
  const [licences, setLicences] = useState(false);
  const rateUrl = appStoreReviewUrl();      // null until the App Store listing exists
  return (
    <Sheet title={`About ${SITE.brandName}`}>
      <div className="about-head">
        <span className="about-head__mark" aria-hidden><Icon name="hull" size={26} /></span>
        <div>
          <div className="ui-title-2">{SITE.brandName}</div>
          <div className="ui-sub">Offline charts, GPS navigation and fishing tools</div>
          <div className="about-head__build">Build {build.app}{isNativeShell() ? ' · iPhone app' : ''}</div>
        </div>
      </div>

      <Notice icon="alert" title="Not for navigation">{NOT_FOR_NAVIGATION}</Notice>

      <Section label={`Privacy · updated ${POLICY_UPDATED}`}>
        <Group>
          {POLICY.map((s, i) => (
            <Disclosure key={s.title} summary={<span className="ui-row__title">{s.title}</span>} defaultOpen={i === 0}>
              {s.body.map((p, j) => <p key={j} className="about-para">{p}</p>)}
            </Disclosure>
          ))}
        </Group>
      </Section>

      <Section label="Data sources & credits">
        <Group>
          {SOURCES.map((s) => (
            <ListRow key={s.name} title={s.name} subtitle={s.what} trailing={<Icon name="external" size={16} />} onPress={() => openExternal(s.url)} />
          ))}
          <ListRow icon="info" title="Open-source licences" subtitle="React, Leaflet, icons, fonts and the rest this app is built with" chevron onPress={() => setLicences(true)} />
        </Group>
      </Section>

      <Section label="Help">
        <Group>
          <ListRow icon="message" title="Report a problem or ask a question" subtitle={`Opens the ${SITE.brandName} issue tracker`} chevron onPress={() => openExternal(SUPPORT_URL)} />
          {rateUrl && <ListRow icon="star" title="Rate on the App Store" chevron onPress={() => openExternal(rateUrl)} />}
        </Group>
      </Section>
      {licences && <Suspense fallback={null}><LicensesModal onClose={() => setLicences(false)} /></Suspense>}
    </Sheet>
  );
}
