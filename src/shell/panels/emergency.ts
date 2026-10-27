/* Pure helpers for the Emergency sheet (kept out of the component so they can be unit-tested). */
import { formatCoord, GPS_STALE_MS } from '../../engine/gps.js';

/** The "Text my location for help" message. Legacy wording; when the fix is older than the
 *  GPS-stale limit it says when the position was taken, so a rescuer never mistakes an old
 *  position for where the boat is now. */
export function emergencySmsBody(lat: number, lng: number, fixAt: number, now: number): string {
  const la = lat.toFixed(5), ln = lng.toFixed(5);
  const stale = fixAt > 0 && now - fixAt > GPS_STALE_MS;
  const when = stale
    ? ' (last GPS fix at ' + new Date(fixAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' — I may have moved since)'
    : '';
  return '⚠️ HELP - I need assistance. My position: ' + formatCoord(lat, 'lat') + ' ' + formatCoord(lng, 'lon') +
    ' (' + la + ', ' + ln + ')' + when + ' https://maps.google.com/?q=' + la + ',' + ln + ' - sent from FishApp';
}
