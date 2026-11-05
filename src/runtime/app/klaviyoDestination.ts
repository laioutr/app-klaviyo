import { fetchCart } from './klaviyoCart';
import {
  type AddToCartPayload,
  type BeginCheckoutPayload,
  compact,
  mapAddedToCart,
  mapStartedCheckout,
  mapViewedProduct,
  type ViewItemPayload,
} from './klaviyoEvents';
import { clearKlaviyoCookies, ensureKlaviyo, getKlaviyo, isKlaviyoLoaded } from './klaviyoScript';
import { defineAnalyticsDestination, fetchAction, useAnalytics, useConsentStore, useNuxtApp } from '#imports';
import { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import { CustomerGetCurrentAction } from '@laioutr-core/canonical-types/ecommerce';
import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';
import type { AnalyticsEvent } from '@laioutr-core/core-types/analytics';

/**
 * The cart sheet fires `AddToCart` about 500 ms before it saves a quantity change, so a cart fetched
 * straight away would report the previous quantity.
 */
export const ADD_TO_CART_SETTLE_MS = 800;

const ADVERTISING = 'advertising';

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * No `filter`: the delivery queue checks it before `init`, so limiting it to commerce events would
 * hold back the script, and forms with it, until the first product view. No `klaviyo.*` call is ever
 * awaited or returned either: with a blocked script their promises never settle, which would stall
 * this destination's queue.
 */
export const createKlaviyoDestination = (
  companyId: string,
  sendStartedCheckout: boolean
): ReturnType<typeof defineAnalyticsDestination> => {
  // Resolved at registration: the bus delivers through an async queue, and composables no longer
  // resolve once an await has run.
  const nuxt = useNuxtApp();
  const consent = useConsentStore();
  let lastViewedProductId: unknown;

  const identifyCustomer = async () => {
    try {
      const { customer } = await nuxt.runWithContext(() => fetchAction(CustomerGetCurrentAction));
      if (customer.email && consent.hasPurposeConsent(ADVERTISING)) {
        getKlaviyo().identify(
          compact({ email: customer.email, first_name: customer.person?.firstName, last_name: customer.person?.lastName })
        );
      }
    } catch {
      // The action rejects for a visitor without a session, which is the ordinary case.
    }
  };

  const trackViewedProduct = (event: AnalyticsEvent) => {
    const { viewedProduct, viewedItem } = mapViewedProduct(event.payload as ViewItemPayload);
    // Core re-fires this on every variant switch, which is one product to Klaviyo.
    if (viewedProduct.ProductID === lastViewedProductId) {
      return;
    }
    lastViewedProductId = viewedProduct.ProductID;
    getKlaviyo().track('Viewed Product', viewedProduct);
    getKlaviyo().trackViewedItem(viewedItem);
  };

  // The bus only checks consent before `track` starts, and the visitor can withdraw during either wait.
  const trackAddedToCart = async (event: AnalyticsEvent) => {
    await wait(ADD_TO_CART_SETTLE_MS);
    if (!consent.hasPurposeConsent(ADVERTISING)) {
      return;
    }
    const cart = await nuxt.runWithContext(() => fetchCart());
    if (!consent.hasPurposeConsent(ADVERTISING)) {
      return;
    }
    getKlaviyo().track('Added to Cart', mapAddedToCart(event.payload as AddToCartPayload, cart));
  };

  const trackStartedCheckout = async (event: AnalyticsEvent) => {
    if (!sendStartedCheckout) {
      return;
    }
    const cart = await nuxt.runWithContext(() => fetchCart());
    if (!consent.hasPurposeConsent(ADVERTISING)) {
      return;
    }
    getKlaviyo().track('Started Checkout', mapStartedCheckout(event.id, event.payload as BeginCheckoutPayload, cart?.checkoutUrl));
  };

  return defineAnalyticsDestination({
    id: 'klaviyo',
    consent: { purposes: [ADVERTISING] },
    async init() {
      ensureKlaviyo(companyId);
      // Not awaited: identification must not hold back the visitor's first events.
      identifyCustomer();
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
        default: {
          // Everything else only serves to trigger `init`.
        }
      }
    },
    /** Klaviyo documents that a loaded tracker only stops on reload. The bus won't load it again. */
    teardown() {
      // The script can be there without `init` having run: a newsletter signup loads it too.
      if (!isKlaviyoLoaded() || consent.hasPurposeConsent(ADVERTISING)) {
        return;
      }
      clearKlaviyoCookies();
      window.location.reload();
    },
  });
};

export interface KlaviyoTrackingConfig {
  companyId?: string;
  onsiteTracking?: boolean;
  sendStartedCheckout?: boolean;
}

export const startKlaviyoTracking = (config: KlaviyoTrackingConfig): void => {
  if (!config.onsiteTracking) {
    return;
  }

  // Typed into the Cockpit by hand, so stray spaces are expected.
  const companyId = config.companyId?.trim();
  if (!companyId) {
    console.warn('[@laioutr/app-klaviyo] Storefront tracking is on, but no company ID is set. Klaviyo will not load.');
    return;
  }

  const consent = useConsentStore();

  useAnalytics().register(createKlaviyoDestination(companyId, config.sendStartedCheckout ?? false));

  // `SubscribeAction` runs on the server, so this is the only moment the browser learns who signed up.
  useNuxtApp().hook('orchestr:action:fetch:finally', ({ token, input, output }) => {
    if (token !== SubscribeAction || !consent.hasPurposeConsent(ADVERTISING)) {
      return;
    }
    // A failed action leaves `output` empty. The hook's own `error` field is never set.
    if (output?.status !== 'success' && output?.status !== 'already-subscribed') {
      return;
    }
    ensureKlaviyo(companyId);
    getKlaviyo().identify({ email: input.email });
  });
};
