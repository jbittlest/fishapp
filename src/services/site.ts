/* Public identity of the app: brand name, the deployed web address and store listings.
 * One source for the app, the share cards/links and the build tools (tools/*.mjs read the same
 * JSON), so a rename or a custom domain is a one-file change. Store ids stay null until the
 * listings exist; callers hide store links while they are null. */
import site from '../site.config.json';

export interface SiteConfig {
  brandName: string;
  /** Absolute URL of the deployed web app, with trailing slash. */
  siteUrl: string;
  /** siteUrl without the scheme, for printing on cards and posters. */
  shortUrl: string;
  appStoreId: string | null;
  /** App Store Connect provider token (pt=) for campaign links. */
  appStoreProviderToken: string | null;
  playStoreUrl: string | null;
}

export const SITE: SiteConfig = site as SiteConfig;

/** The App Store page, optionally tagged with a campaign token (ct=) for App Analytics. */
export function appStoreUrl(campaign?: string): string | null {
  if (!SITE.appStoreId) return null;
  const u = new URL('https://apps.apple.com/app/id' + SITE.appStoreId);
  if (campaign && SITE.appStoreProviderToken) {
    u.searchParams.set('pt', SITE.appStoreProviderToken);
    u.searchParams.set('ct', campaign);
  }
  return u.toString();
}
