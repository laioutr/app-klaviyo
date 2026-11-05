import { installKlaviyoQueue } from './klaviyoQueue';

export interface KlaviyoClient {
  track(name: string, properties?: Record<string, unknown>): unknown;
  trackViewedItem(item: Record<string, unknown>): unknown;
  identify(properties: Record<string, unknown>): unknown;
}

declare global {
  interface Window {
    klaviyo?: KlaviyoClient;
  }
}

const SCRIPT_SELECTOR = 'script[src*="static.klaviyo.com/onsite/js/"]';

export const isKlaviyoLoaded = (): boolean => document.querySelector(SCRIPT_SELECTOR) !== null;

/** Safe to call repeatedly. Klaviyo warns that a second copy of the script can break tracking. */
export const ensureKlaviyo = (companyId: string): void => {
  installKlaviyoQueue();

  if (isKlaviyoLoaded()) {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://static.klaviyo.com/onsite/js/${encodeURIComponent(companyId)}/klaviyo.js`;
  document.head.appendChild(script);
};

/** Read on every call, because klaviyo.js may replace the queue's object when it loads. */
export const getKlaviyo = (): KlaviyoClient => window.klaviyo!;

/** Every domain a cookie for this host could sit on. A bare TLD cannot hold one. */
export const klaviyoCookieDomains = (hostname: string): string[] => {
  const labels = hostname.split('.');
  return labels.slice(0, -1).map((_label, index) => labels.slice(index).join('.'));
};

/** The cookie's domain is Klaviyo's choice, so it is expired on the host and every parent domain. */
export const clearKlaviyoCookies = (): void => {
  const expired = '__kla_id=; Max-Age=0; path=/';
  document.cookie = expired;

  for (const domain of klaviyoCookieDomains(window.location.hostname)) {
    document.cookie = `${expired}; domain=${domain}`;
  }
};
