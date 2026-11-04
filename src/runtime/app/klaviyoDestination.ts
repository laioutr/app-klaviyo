import { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';
import type { AnalyticsEvent } from '@laioutr-core/core-types/analytics';
import type { AnalyticsDestination } from '#imports';
import { compact, mapAddedToCart, mapStartedCheckout, mapViewedProduct, type KlaviyoCart } from './klaviyoEvents';
import type { KlaviyoClient } from './klaviyoScript';

/**
 * The cart sheet fires `AddToCart` about 500 ms before it saves a quantity change, so a cart fetched
 * straight away would report the previous quantity.
 */
export const ADD_TO_CART_SETTLE_MS = 800;

export interface CurrentCustomer {
  email?: string;
  person?: { firstName?: string; lastName?: string };
}

export interface KlaviyoDestinationDeps {
  sendStartedCheckout: boolean;
  load(): void;
  klaviyo(): KlaviyoClient;
  fetchCart(): Promise<KlaviyoCart | undefined>;
  fetchCustomer(): Promise<{ customer: CurrentCustomer }>;
  hasConsent(): boolean;
  clearCookies(): void;
  reload(): void;
}

export type KlaviyoDestinationConfig = Omit<AnalyticsDestination, 'stage'>;

type ViewedPayload = Parameters<typeof mapViewedProduct>[0];
type CartPayload = Parameters<typeof mapAddedToCart>[0];

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * No `filter`: the delivery queue checks it before `init`, so limiting it to commerce events would
 * hold back the script, and forms with it, until the first product view. No `klaviyo.*` call is ever
 * awaited or returned either: with a blocked script their promises never settle, which would stall
 * this destination's queue.
 */
export const createKlaviyoDestination = (deps: KlaviyoDestinationDeps): KlaviyoDestinationConfig => {
  let loaded = false;
  let lastViewedProductId: unknown;

  const identifyCustomer = async () => {
    try {
      const { customer } = await deps.fetchCustomer();
      if (customer.email && deps.hasConsent()) {
        deps.klaviyo().identify(compact({ email: customer.email, first_name: customer.person?.firstName, last_name: customer.person?.lastName }));
      }
    } catch {
      // The action rejects for a visitor without a session, which is the ordinary case.
    }
  };

  const trackViewedProduct = (event: AnalyticsEvent) => {
    const { viewedProduct, viewedItem } = mapViewedProduct(event.payload as ViewedPayload);
    // Core re-fires this on every variant switch, which is one product to Klaviyo.
    if (viewedProduct.ProductID === lastViewedProductId) {
      return;
    }
    lastViewedProductId = viewedProduct.ProductID;
    deps.klaviyo().track('Viewed Product', viewedProduct);
    deps.klaviyo().trackViewedItem(viewedItem);
  };

  // The bus only checks consent before `track` starts, and the visitor can withdraw during either wait.
  const trackAddedToCart = async (event: AnalyticsEvent) => {
    await wait(ADD_TO_CART_SETTLE_MS);
    if (!deps.hasConsent()) {
      return;
    }
    const cart = await deps.fetchCart();
    if (!deps.hasConsent()) {
      return;
    }
    deps.klaviyo().track('Added to Cart', mapAddedToCart(event.payload as CartPayload, cart));
  };

  const trackStartedCheckout = async (event: AnalyticsEvent) => {
    if (!deps.sendStartedCheckout) {
      return;
    }
    const cart = await deps.fetchCart();
    if (!deps.hasConsent()) {
      return;
    }
    deps.klaviyo().track('Started Checkout', mapStartedCheckout(event.id, event.payload as CartPayload, cart?.checkoutUrl));
  };

  return {
    id: 'klaviyo',
    consent: { purposes: ['advertising'] },
    async init() {
      deps.load();
      loaded = true;
      // Not awaited: identification must not hold back the visitor's first events.
      void identifyCustomer();
    },
    async track(event) {
      switch (event.type) {
        case ViewItem: {
          trackViewedProduct(event);
          break;
        }
        case AddToCart: {
          await trackAddedToCart(event);
          break;
        }
        case BeginCheckout: {
          await trackStartedCheckout(event);
          break;
        }
        // Everything else only serves to trigger `init`.
      }
    },
    /** Klaviyo documents that a loaded tracker only stops on reload. The bus won't load it again. */
    teardown() {
      if (!loaded || deps.hasConsent()) {
        return;
      }
      deps.clearCookies();
      deps.reload();
    },
  };
};

export interface KlaviyoTrackingConfig {
  companyId?: string;
  onsiteTracking?: boolean;
  sendStartedCheckout?: boolean;
}

export interface ActionFinished {
  token: unknown;
  input?: any;
  output?: any;
  error?: unknown;
}

export interface KlaviyoTrackingDeps extends Omit<KlaviyoDestinationDeps, 'sendStartedCheckout' | 'load'> {
  load(companyId: string): void;
  register(config: KlaviyoDestinationConfig): void;
  onActionFinished(handler: (args: ActionFinished) => void): void;
  warn(message: string): void;
}

export const startKlaviyoTracking = (config: KlaviyoTrackingConfig, deps: KlaviyoTrackingDeps): void => {
  if (!config.onsiteTracking) {
    return;
  }

  // Typed into the Cockpit by hand, so stray spaces are expected.
  const companyId = config.companyId?.trim();
  if (!companyId) {
    deps.warn('[@laioutr/app-klaviyo] Storefront tracking is on, but no company ID is set. Klaviyo will not load.');
    return;
  }

  const load = () => deps.load(companyId);

  deps.register(createKlaviyoDestination({ ...deps, load, sendStartedCheckout: config.sendStartedCheckout ?? false }));

  // `SubscribeAction` runs on the server, so this is the only moment the browser learns who signed up.
  deps.onActionFinished(({ token, input, output, error }) => {
    if (token !== SubscribeAction || error || !deps.hasConsent()) {
      return;
    }
    if (output?.status !== 'success' && output?.status !== 'already-subscribed') {
      return;
    }
    load();
    deps.klaviyo().identify({ email: input.email });
  });
};
