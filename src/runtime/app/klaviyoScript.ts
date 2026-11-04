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

/** Safe to call repeatedly. Klaviyo warns that a second copy of the script can break tracking. */
export const ensureKlaviyo = (companyId: string): void => {
  installKlaviyoQueue();

  if (document.querySelector(SCRIPT_SELECTOR)) {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://static.klaviyo.com/onsite/js/${encodeURIComponent(companyId)}/klaviyo.js`;
  document.head.appendChild(script);
};

/** Read on every call, because klaviyo.js may replace the queue's object when it loads. */
export const getKlaviyo = (): KlaviyoClient => window.klaviyo!;

/** The cookie's domain is Klaviyo's choice, so it is expired on the host and every parent domain. */
export const clearKlaviyoCookies = (): void => {
  const expired = '__kla_id=; Max-Age=0; path=/';
  document.cookie = expired;

  const labels = window.location.hostname.split('.');
  for (let index = 0; index < labels.length - 1; index++) {
    document.cookie = `${expired}; domain=${labels.slice(index).join('.')}`;
  }
};
