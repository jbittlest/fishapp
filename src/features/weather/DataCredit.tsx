/* Linked data-source credits for blocks of third-party data. Open-Meteo's CC BY 4.0 terms ask for
 * "a link next to any location Open-Meteo data are displayed"; the MUR SST dataset asks for its
 * acknowledgement (texts in engine/datasources.js). Small and quiet: caption size, tertiary text.
 *
 * The link is a real link on the web (the browser opens a new tab itself); in the iOS app the tap
 * is handed to Safari (NativeBridge "openURL"), so the chart is never navigated away. */
import type { MouseEvent, ReactNode } from 'react';
import { isNativeShell, openExternal } from '../../services/native';
import { OPEN_METEO_CREDIT, OPEN_METEO_URL } from '../../engine/datasources.js';
import './weather.css';

export function CreditLink({ href, children }: { href: string; children: ReactNode }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isNativeShell()) return;
    e.preventDefault();
    openExternal(href);
  };
  return <a className="wx-credit__link" href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>{children}</a>;
}

/** "Weather data by Open-Meteo.com", linked: under every block of Open-Meteo data. */
export function OpenMeteoCredit({ className }: { className?: string }) {
  return (
    <p className={'wx-credit' + (className ? ' ' + className : '')}>
      <CreditLink href={OPEN_METEO_URL}>{OPEN_METEO_CREDIT}</CreditLink>
    </p>
  );
}
