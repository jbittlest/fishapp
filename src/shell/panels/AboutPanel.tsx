/* About — version, the not-for-navigation statement, the privacy policy (in full, offline) and
 * data-source credits. App Review requires the privacy policy to be reachable inside the app. */
import { Disclosure, Group, Icon, ListRow, Notice, Section, Sheet } from '../../ui';
import { useUi } from '../../services/ui';
import { openExternal, isNativeShell } from '../../services/native';
import { NOT_FOR_NAVIGATION, POLICY, POLICY_UPDATED, SOURCES, SUPPORT_URL } from '../../legal/privacy.js';

export default function AboutPanel() {
  const build = useUi((s) => s.build);
  return (
    <Sheet title="About FishApp">
      <div className="about-head">
        <span className="about-head__mark" aria-hidden><Icon name="hull" size={26} /></span>
        <div>
          <div className="ui-title-2">FishApp</div>
          <div className="ui-sub">Offline charts, GPS navigation and fishing tools · build {build.app}{isNativeShell() ? ' · iPhone app' : ''}</div>
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
        </Group>
      </Section>

      <Section label="Help">
        <Group>
          <ListRow icon="message" title="Report a problem or ask a question" subtitle="Opens the FishApp issue tracker" chevron onPress={() => openExternal(SUPPORT_URL)} />
        </Group>
      </Section>
    </Sheet>
  );
}
