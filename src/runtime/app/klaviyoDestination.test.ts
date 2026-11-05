import { getNuxtAppCtx } from '#app/nuxt';
import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { createError } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { ADD_TO_CART_SETTLE_MS, createKlaviyoDestination, startKlaviyoTracking } from './klaviyoDestination';
import { fetchAction, useAnalytics, useConsentStore, useNuxtApp } from '#imports';
import { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import { CartAddItemsAction, CustomerGetCurrentAction } from '@laioutr-core/canonical-types/ecommerce';
import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';
import type { ConsentReport, ConsentState } from '#frontend/consent';
import { cartLine, cartStream, eur, orchestrStream } from '../../../test/support/orchestr';

const event = (type: string, payload: object, id = 'evt-1') =>
  ({ id, type, version: '1-0-0', time: '2026-11-04T00:00:00.000Z', payload, contexts: {} }) as any;
const view = (productId: string, sku?: string) => event(ViewItem, { product: { productId, sku } });
const add = event(AddToCart, { products: [{ productId: '123', name: 'Tee', quantity: 1 }], value: eur(1999) });
const begin = event(BeginCheckout, { products: [{ productId: '123', name: 'Tee', quantity: 1 }], value: eur(1999) }, 'evt-9');

const nuxt = useNuxtApp();
const consent = useConsentStore();

/** The calls that reached Klaviyo's real queue, without the callback the snippet appends to each. */
const sent = () => ((window as any)._klOnsite ?? []).map((entry: unknown[]) => entry.slice(0, -1));
const sentNames = () => sent().map(([method, name]: unknown[]) => (method === 'track' ? name : method));
const scriptSrc = () => document.querySelector<HTMLScriptElement>('script[src*="static.klaviyo.com/onsite/js/"]')?.src;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let respondToCart: () => unknown;
let respondToCustomer: () => unknown;
let respondToSubscribe: () => unknown;
let cartRequests = 0;

registerEndpoint('/api/orchestr/query', {
  method: 'POST',
  handler: () => {
    cartRequests++;
    return respondToCart();
  },
});
registerEndpoint(`/api/orchestr/action/${CustomerGetCurrentAction}`, { method: 'POST', handler: () => respondToCustomer() });
registerEndpoint(`/api/orchestr/action/${SubscribeAction}`, { method: 'POST', handler: () => respondToSubscribe() });
registerEndpoint(`/api/orchestr/action/${CartAddItemsAction}`, {
  method: 'POST',
  handler: () => orchestrStream({ output: { status: 'success' } }),
});

const guest = () => {
  throw createError({ statusCode: 401 });
};

let stopConsent: (() => void) | undefined;
let report: ConsentReport | undefined;

/** A CMP the test drives by hand, so the store's own watcher, and the bus behind it, stay in the path. */
const setConsent = async (state: Partial<ConsentState>) => {
  if (stopConsent) {
    report?.(state);
  } else {
    stopConsent = consent.setAdapter({
      name: 'klaviyo-test',
      openConsentUi: () => {},
      hasDecision: () => true,
      setup: (push) => {
        report = push;
        push(state);
      },
    });
  }
  await nextTick();
};

const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

/** Runs the settle wait on a fake clock, then hands back the real one so the cart request can finish. */
const trackAdd = async (destination: ReturnType<typeof createKlaviyoDestination>) => {
  vi.useFakeTimers();
  const pending = destination.track(add);
  await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS);
  vi.useRealTimers();
  await pending;
};

beforeEach(async () => {
  cartRequests = 0;
  respondToCart = () =>
    cartStream([cartLine('line-1', { code: 'TEE-M' })], { checkoutLink: { type: 'url', href: 'https://shop.test/checkout' } }, 5997);
  respondToCustomer = guest;
  respondToSubscribe = () => orchestrStream({ output: { status: 'success' } });
  reload.mockClear();
  await setConsent({ advertising: true });
});

afterEach(async () => {
  vi.useRealTimers();
  useAnalytics().unregister('klaviyo');
  // A decision is what empties the bus's replay buffer, which would otherwise reach the next test.
  await setConsent({ advertising: false });
  await flush();
  stopConsent?.();
  stopConsent = undefined;
  await nextTick();
  document.querySelector('script[src*="static.klaviyo.com/onsite/js/"]')?.remove();
  delete (window as any).klaviyo;
  delete (window as any)._klOnsite;
  document.cookie = '__kla_id=; Max-Age=0; path=/';
});

describe('createKlaviyoDestination', () => {
  /** The bus always runs `init` first, and `init` is what installs the queue. */
  const started = async (sendStartedCheckout = false) => {
    const destination = createKlaviyoDestination('AbC123', sendStartedCheckout);
    await destination.init!();
    await flush();
    return destination;
  };

  it('declares its id and consent, with no filter and no denied delivery', () => {
    const destination = createKlaviyoDestination('AbC123', false);
    expect(destination.id).toBe('klaviyo');
    expect(destination.consent).toEqual({ purposes: ['advertising'] });
    expect(destination.filter).toBeUndefined();
    expect(destination.onDenied).toBeUndefined();
  });

  it('ignores events it does not map', async () => {
    const destination = await started();
    await destination.track(event('web/page_view', {}));
    expect(sent()).toEqual([]);
    expect(cartRequests).toBe(0);
  });

  it('sends a product view to both Klaviyo calls and never waits on them', async () => {
    const destination = await started();
    // The queue's promises stay pending, so this would hang if `track` waited on them.
    await destination.track(view('gid://shopify/Product/123'));
    expect(sent()).toEqual([
      ['track', 'Viewed Product', { ProductID: '123' }],
      ['trackViewedItem', { ItemId: '123' }],
    ]);
  });

  it('skips a repeat view from a variant switch, and sends A, B, A three times', async () => {
    const destination = await started();
    await destination.track(view('A', 'A-S'));
    await destination.track(view('A', 'A-M'));
    await destination.track(view('B'));
    await destination.track(view('A'));
    expect(sentNames().filter((name: string) => name === 'Viewed Product')).toHaveLength(3);
  });

  it('waits before fetching the cart on an add, then sends the whole cart', async () => {
    const destination = await started();
    vi.useFakeTimers();
    const pending = destination.track(add);

    expect(ADD_TO_CART_SETTLE_MS).toBe(800);
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS - 1);
    expect(cartRequests).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await pending;

    expect(sent()).toEqual([
      [
        'track',
        'Added to Cart',
        expect.objectContaining({
          $value: 59.97,
          CheckoutURL: 'https://shop.test/checkout',
          Items: [expect.objectContaining({ ProductID: 'TEE-M', Quantity: 2 })],
        }),
      ],
    ]);
  });

  it('still sends the add when the cart is unavailable', async () => {
    respondToCart = () => {
      throw createError({ statusCode: 500 });
    };
    await trackAdd(await started());
    expect(sent()).toEqual([['track', 'Added to Cart', expect.objectContaining({ $value: 19.99, ItemNames: ['Tee'] })]]);
  });

  it('drops the add when consent goes during the wait', async () => {
    const destination = await started();
    vi.useFakeTimers();
    const pending = destination.track(add);
    await setConsent({ advertising: false });
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS);
    vi.useRealTimers();
    await pending;
    expect(cartRequests).toBe(0);
    expect(sent()).toEqual([]);
  });

  it('drops the add when consent goes during the cart fetch', async () => {
    respondToCart = async () => {
      await setConsent({ advertising: false });
      return cartStream([]);
    };
    await trackAdd(await started());
    expect(cartRequests).toBe(1);
    expect(sent()).toEqual([]);
  });

  it('ignores a checkout start when the setting is off', async () => {
    const destination = await started();
    await destination.track(begin);
    expect(cartRequests).toBe(0);
    expect(sent()).toEqual([]);
  });

  it('sends a checkout start without waiting when the setting is on', async () => {
    const destination = await started(true);
    await destination.track(begin);
    expect(sent()).toEqual([
      [
        'track',
        'Started Checkout',
        expect.objectContaining({ $event_id: 'evt-9', $value: 19.99, CheckoutURL: 'https://shop.test/checkout' }),
      ],
    ]);
  });

  describe('with no Nuxt context, as after any await in the bus queue', () => {
    const context = getNuxtAppCtx(nuxt._id);

    afterEach(() => {
      context.set(nuxt);
    });

    it('still identifies the customer', async () => {
      respondToCustomer = () => orchestrStream({ output: { customer: { email: 'a@test.com' } } });
      const destination = createKlaviyoDestination('AbC123', false);
      context.unset();
      await destination.init!();
      await vi.waitFor(() => expect(sentNames()).toEqual(['identify']));
    });

    it('still sends the whole cart with its links', async () => {
      respondToCustomer = guest;
      const destination = await started();
      context.unset();
      await trackAdd(destination);
      expect(sent()).toEqual([['track', 'Added to Cart', expect.objectContaining({ CheckoutURL: 'https://shop.test/checkout' })]]);
    });
  });

  describe('init', () => {
    const customer = { email: 'a@test.com', phone: '+49', person: { firstName: 'Ada', lastName: 'L' } };

    it('loads the script and identifies a logged-in customer, without the phone', async () => {
      respondToCustomer = () => orchestrStream({ output: { customer } });
      await started();
      expect(scriptSrc()).toBe('https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js');
      expect(sent()).toEqual([['identify', { email: 'a@test.com', first_name: 'Ada', last_name: 'L' }]]);
    });

    it('does not identify when consent goes while the customer loads', async () => {
      respondToCustomer = async () => {
        await setConsent({ advertising: false });
        return orchestrStream({ output: { customer } });
      };
      await started();
      await flush();
      expect(sent()).toEqual([]);
    });

    it('does not wait for the customer', async () => {
      respondToCustomer = () => new Promise(() => {});
      await expect(createKlaviyoDestination('AbC123', false).init!()).resolves.toBeUndefined();
    });

    it.each([
      ['a guest', guest],
      ['a customer without an email', () => orchestrStream({ output: { customer: { person: { firstName: 'Ada' } } } })],
    ])('does not identify %s', async (_name, respond) => {
      respondToCustomer = respond;
      await started();
      await flush();
      expect(sent()).toEqual([]);
    });
  });

  describe('teardown', () => {
    it('clears the cookie and reloads when consent is gone', async () => {
      const destination = await started();
      document.cookie = '__kla_id=abc; path=/';
      await setConsent({ advertising: false });
      await destination.teardown!();
      expect(document.cookie).not.toContain('__kla_id=abc');
      expect(reload).toHaveBeenCalledOnce();
    });

    it('does nothing while consent is still granted', async () => {
      const destination = await started();
      document.cookie = '__kla_id=abc; path=/';
      await destination.teardown!();
      expect(document.cookie).toContain('__kla_id=abc');
      expect(reload).not.toHaveBeenCalled();
    });

    it('does nothing when the script never loaded', async () => {
      document.cookie = '__kla_id=abc; path=/';
      await setConsent({ advertising: false });
      await createKlaviyoDestination('AbC123', false).teardown!();
      expect(document.cookie).toContain('__kla_id=abc');
      expect(reload).not.toHaveBeenCalled();
    });
  });
});

describe('startKlaviyoTracking', () => {
  const on = { companyId: 'AbC123', onsiteTracking: true };
  const signup = () => fetchAction(SubscribeAction, { email: 'a@test.com', phone: '+49' } as any);
  const addHook = vi.spyOn(nuxt, 'hook');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  /** A product view as the UI emits it, through the real bus. */
  const trackView = async () => {
    useAnalytics().track(ViewItem, { product: { productId: '123', name: 'Tee' } } as any);
    await flush();
  };

  beforeEach(() => {
    addHook.mockClear();
    warn.mockClear();
  });

  afterEach(() => {
    for (const { value: unhook } of addHook.mock.results) {
      unhook();
    }
  });

  it.each([[{ companyId: 'AbC123', onsiteTracking: false }], [{ companyId: 'AbC123' }]])(
    'stays silent with tracking off: %j',
    async (config) => {
      startKlaviyoTracking(config);
      await trackView();
      await signup();
      await flush();
      expect(scriptSrc()).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.each([[{ onsiteTracking: true }], [{ companyId: '   ', onsiteTracking: true }]])(
    'warns and loads nothing without a company id: %j',
    async (config) => {
      startKlaviyoTracking(config);
      await trackView();
      expect(warn).toHaveBeenCalledOnce();
      expect(scriptSrc()).toBeUndefined();
    }
  );

  it('loads with a trimmed company id on the first event and delivers it', async () => {
    startKlaviyoTracking({ companyId: '  AbC123 ', onsiteTracking: true });
    await trackView();
    expect(scriptSrc()).toBe('https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js');
    expect(sentNames()).toEqual(['Viewed Product', 'trackViewedItem']);
  });

  it('holds everything back until consent is granted', async () => {
    await setConsent({ advertising: false });
    startKlaviyoTracking(on);
    await trackView();
    expect(scriptSrc()).toBeUndefined();
    expect((window as any).klaviyo).toBeUndefined();
  });

  it('passes sendStartedCheckout through', async () => {
    startKlaviyoTracking({ ...on, sendStartedCheckout: true });
    useAnalytics().track(BeginCheckout, { products: [{ productId: '123' }], value: eur(1999) } as any);
    await vi.waitFor(() => expect(sentNames()).toContain('Started Checkout'));
  });

  it('clears the cookie and reloads when consent is withdrawn', async () => {
    startKlaviyoTracking(on);
    await trackView();
    document.cookie = '__kla_id=abc; path=/';
    await setConsent({ advertising: false });
    await flush();
    expect(document.cookie).not.toContain('__kla_id=abc');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not reload on withdrawal when the script never loaded', async () => {
    startKlaviyoTracking(on);
    await setConsent({ advertising: false });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(['success', 'already-subscribed'])('identifies a signup with status %s, email only', async (status) => {
    respondToSubscribe = () => orchestrStream({ output: { status } });
    startKlaviyoTracking(on);
    await signup();
    await flush();
    expect(scriptSrc()).toBe('https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js');
    expect(sent()).toEqual([['identify', { email: 'a@test.com' }]]);
  });

  it('does not identify after another action', async () => {
    startKlaviyoTracking(on);
    await fetchAction(CartAddItemsAction, { email: 'a@test.com' } as any);
    await flush();
    expect(sent()).toEqual([]);
  });

  it('does not identify after a failed signup', async () => {
    respondToSubscribe = () => {
      throw createError({ statusCode: 500 });
    };
    startKlaviyoTracking(on);
    await expect(signup()).rejects.toThrow();
    await flush();
    expect(sent()).toEqual([]);
  });

  it('does not identify after an error status', async () => {
    respondToSubscribe = () => orchestrStream({ output: { status: 'error' } });
    startKlaviyoTracking(on);
    await signup();
    await flush();
    expect(sent()).toEqual([]);
  });

  it('clears and reloads on withdrawal when a signup loaded the script', async () => {
    startKlaviyoTracking(on);
    await signup();
    await flush();
    document.cookie = '__kla_id=abc; path=/';
    await setConsent({ advertising: false });
    await flush();
    expect(document.cookie).not.toContain('__kla_id=abc');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('does not identify a signup without consent', async () => {
    await setConsent({ advertising: false });
    startKlaviyoTracking(on);
    await signup();
    await flush();
    expect(scriptSrc()).toBeUndefined();
    expect(sent()).toEqual([]);
  });
});
