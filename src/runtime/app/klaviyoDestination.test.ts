import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_TO_CART_SETTLE_MS, createKlaviyoDestination, startKlaviyoTracking } from './klaviyoDestination';
import { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const event = (type: string, payload: object, id = 'evt-1') =>
  ({ id, type, version: '1-0-0', time: '2026-11-04T00:00:00.000Z', payload, contexts: {} }) as any;
const view = (productId: string, sku?: string) => event(ViewItem, { product: { productId, sku } });
const add = event(AddToCart, { products: [{ productId: '123', name: 'Tee', quantity: 1 }], value: eur(1999) });
const begin = event(BeginCheckout, { products: [{ productId: '123', name: 'Tee', quantity: 1 }], value: eur(1999) }, 'evt-9');
const cart = { value: 59.97, checkoutUrl: 'https://shop.test/checkout', items: [{ ProductID: '123', ProductName: 'Tee' }] };

const makeDeps = (overrides = {}) => {
  // Mirrors the real queue: calls return a promise that never settles.
  const client = {
    track: vi.fn(() => new Promise(() => {})),
    trackViewedItem: vi.fn(() => new Promise(() => {})),
    identify: vi.fn(() => new Promise(() => {})),
  };
  let loaded = false;
  return {
    client,
    deps: {
      sendStartedCheckout: false,
      load: vi.fn(() => {
        loaded = true;
      }),
      isLoaded: () => loaded,
      klaviyo: () => client,
      fetchCart: vi.fn(async () => cart),
      fetchCustomer: vi.fn(async () => {
        throw new Error('unauthenticated');
      }),
      hasConsent: vi.fn(() => true),
      clearCookies: vi.fn(),
      reload: vi.fn(),
      ...overrides,
    } as any,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createKlaviyoDestination', () => {
  it('declares its id and consent, with no filter and no denied delivery', () => {
    const destination = createKlaviyoDestination(makeDeps().deps);
    expect(destination.id).toBe('klaviyo');
    expect(destination.consent).toEqual({ purposes: ['advertising'] });
    expect(destination.filter).toBeUndefined();
    expect(destination.onDenied).toBeUndefined();
  });

  it('ignores events it does not map', async () => {
    const { deps, client } = makeDeps();
    await createKlaviyoDestination(deps).track(event('web/page_view', {}));
    expect(client.track).not.toHaveBeenCalled();
    expect(deps.fetchCart).not.toHaveBeenCalled();
  });

  it('sends a product view to both Klaviyo calls and never waits on them', async () => {
    const { deps, client } = makeDeps();
    await createKlaviyoDestination(deps).track(view('gid://shopify/Product/123'));
    expect(client.track).toHaveBeenCalledWith('Viewed Product', { ProductID: '123' });
    expect(client.trackViewedItem).toHaveBeenCalledWith({ ItemId: '123' });
  });

  it('skips a repeat view from a variant switch, and sends A, B, A three times', async () => {
    const { deps, client } = makeDeps();
    const destination = createKlaviyoDestination(deps);
    await destination.track(view('A', 'A-S'));
    await destination.track(view('A', 'A-M'));
    await destination.track(view('B'));
    await destination.track(view('A'));
    expect(client.track).toHaveBeenCalledTimes(3);
  });

  it('waits before fetching the cart on an add, then sends the whole cart', async () => {
    const { deps, client } = makeDeps();
    const pending = createKlaviyoDestination(deps).track(add);
    expect(ADD_TO_CART_SETTLE_MS).toBe(800);
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS - 1);
    expect(deps.fetchCart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(client.track).toHaveBeenCalledWith(
      'Added to Cart',
      expect.objectContaining({ $value: 59.97, Items: cart.items, CheckoutURL: cart.checkoutUrl })
    );
  });

  it('still sends the add when the cart is unavailable', async () => {
    const { deps, client } = makeDeps({ fetchCart: vi.fn(async () => undefined) });
    const pending = createKlaviyoDestination(deps).track(add);
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS);
    await pending;
    expect(client.track).toHaveBeenCalledWith('Added to Cart', expect.objectContaining({ $value: 19.99, ItemNames: ['Tee'] }));
  });

  it('drops the add when consent goes during the wait', async () => {
    const { deps, client } = makeDeps();
    const pending = createKlaviyoDestination(deps).track(add);
    deps.hasConsent.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS);
    await pending;
    expect(deps.fetchCart).not.toHaveBeenCalled();
    expect(client.track).not.toHaveBeenCalled();
  });

  it('drops the add when consent goes during the cart fetch', async () => {
    const { deps, client } = makeDeps();
    deps.fetchCart.mockImplementation(async () => {
      deps.hasConsent.mockReturnValue(false);
      return cart;
    });
    const pending = createKlaviyoDestination(deps).track(add);
    await vi.advanceTimersByTimeAsync(ADD_TO_CART_SETTLE_MS);
    await pending;
    expect(client.track).not.toHaveBeenCalled();
  });

  it('ignores a checkout start when the setting is off', async () => {
    const { deps, client } = makeDeps();
    await createKlaviyoDestination(deps).track(begin);
    expect(deps.fetchCart).not.toHaveBeenCalled();
    expect(client.track).not.toHaveBeenCalled();
  });

  it('sends a checkout start without waiting when the setting is on', async () => {
    const { deps, client } = makeDeps({ sendStartedCheckout: true });
    await createKlaviyoDestination(deps).track(begin);
    expect(client.track).toHaveBeenCalledWith(
      'Started Checkout',
      expect.objectContaining({ $event_id: 'evt-9', $value: 19.99, CheckoutURL: cart.checkoutUrl })
    );
  });

  describe('init', () => {
    const customer = { email: 'a@test.com', phone: '+49', person: { firstName: 'Ada', lastName: 'L' } };

    it('loads the script and identifies a logged-in customer, without the phone', async () => {
      const { deps, client } = makeDeps({ fetchCustomer: vi.fn(async () => ({ customer })) });
      await createKlaviyoDestination(deps).init!();
      await vi.advanceTimersByTimeAsync(0);
      expect(deps.load).toHaveBeenCalledOnce();
      expect(client.identify).toHaveBeenCalledWith({ email: 'a@test.com', first_name: 'Ada', last_name: 'L' });
    });

    it('does not identify when consent goes while the customer loads', async () => {
      const { deps, client } = makeDeps();
      deps.fetchCustomer.mockImplementation(async () => {
        deps.hasConsent.mockReturnValue(false);
        return { customer };
      });
      await createKlaviyoDestination(deps).init!();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.identify).not.toHaveBeenCalled();
    });

    it('does not wait for the customer', async () => {
      const { deps } = makeDeps({ fetchCustomer: vi.fn(() => new Promise(() => {})) });
      await expect(createKlaviyoDestination(deps).init!()).resolves.toBeUndefined();
    });

    it.each([
      [
        'a guest',
        async () => {
          throw new Error('unauthenticated');
        },
      ],
      ['a customer without an email', async () => ({ customer: { person: { firstName: 'Ada' } } })],
    ])('does not identify %s', async (_name, fetchCustomer) => {
      const { deps, client } = makeDeps({ fetchCustomer: vi.fn(fetchCustomer) });
      await createKlaviyoDestination(deps).init!();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.identify).not.toHaveBeenCalled();
    });
  });

  describe('teardown', () => {
    it('clears the cookie and reloads when consent is gone', async () => {
      const { deps } = makeDeps();
      const destination = createKlaviyoDestination(deps);
      await destination.init!();
      deps.hasConsent.mockReturnValue(false);
      await destination.teardown!();
      expect(deps.clearCookies).toHaveBeenCalledOnce();
      expect(deps.reload).toHaveBeenCalledOnce();
    });

    it('does nothing while consent is still granted', async () => {
      const { deps } = makeDeps();
      const destination = createKlaviyoDestination(deps);
      await destination.init!();
      await destination.teardown!();
      expect(deps.reload).not.toHaveBeenCalled();
    });

    it('does nothing when the script never loaded', async () => {
      const { deps } = makeDeps({ hasConsent: vi.fn(() => false) });
      await createKlaviyoDestination(deps).teardown!();
      expect(deps.clearCookies).not.toHaveBeenCalled();
      expect(deps.reload).not.toHaveBeenCalled();
    });
  });
});

describe('startKlaviyoTracking', () => {
  const start = (config: object, overrides = {}) => {
    const { deps, client } = makeDeps(overrides);
    let handler: any;
    const full = {
      ...deps,
      register: vi.fn(),
      warn: vi.fn(),
      onActionFinished: vi.fn((h: any) => {
        handler = h;
      }),
    };
    startKlaviyoTracking(config, full);
    return { full, client, finish: (args: object) => handler?.(args) };
  };
  const on = { companyId: 'AbC123', onsiteTracking: true };
  const signup = { token: SubscribeAction, input: { email: 'a@test.com', phone: '+49' }, output: { status: 'success' } };

  it.each([[{ companyId: 'AbC123', onsiteTracking: false }], [{ companyId: 'AbC123' }]])('stays silent with tracking off: %j', (config) => {
    const { full } = start(config);
    expect(full.register).not.toHaveBeenCalled();
    expect(full.onActionFinished).not.toHaveBeenCalled();
    expect(full.warn).not.toHaveBeenCalled();
  });

  it.each([[{ onsiteTracking: true }], [{ companyId: '   ', onsiteTracking: true }]])(
    'warns and registers nothing without a company id: %j',
    (config) => {
      const { full } = start(config);
      expect(full.warn).toHaveBeenCalledOnce();
      expect(full.register).not.toHaveBeenCalled();
    }
  );

  it('registers the destination and loads with a trimmed company id', async () => {
    const { full } = start({ companyId: '  AbC123 ', onsiteTracking: true });
    await full.register.mock.calls[0]![0].init();
    expect(full.load).toHaveBeenCalledWith('AbC123');
  });

  it('passes sendStartedCheckout through', async () => {
    const { full, client } = start({ ...on, sendStartedCheckout: true });
    await full.register.mock.calls[0]![0].track(begin);
    expect(client.track).toHaveBeenCalledWith('Started Checkout', expect.anything());
  });

  it.each(['success', 'already-subscribed'])('identifies a signup with status %s, email only', (status) => {
    const { full, client, finish } = start(on);
    finish({ ...signup, output: { status } });
    expect(full.load).toHaveBeenCalledWith('AbC123');
    expect(client.identify).toHaveBeenCalledWith({ email: 'a@test.com' });
  });

  it.each([
    ['another action', { ...signup, token: 'ecommerce/cart/add-items' }],
    ['a failed action', { ...signup, output: undefined, error: new Error('x') }],
    ['an error status', { ...signup, output: { status: 'error' } }],
  ])('does not identify after %s', (_name, args) => {
    const { client, finish } = start(on);
    finish(args);
    expect(client.identify).not.toHaveBeenCalled();
  });

  it('clears and reloads on withdrawal when a signup loaded the script', async () => {
    const { full, finish } = start(on);
    finish(signup);
    full.hasConsent.mockReturnValue(false);
    await full.register.mock.calls[0]![0].teardown();
    expect(full.clearCookies).toHaveBeenCalledOnce();
    expect(full.reload).toHaveBeenCalledOnce();
  });

  it('does not identify a signup without consent', () => {
    const { full, client, finish } = start(on, { hasConsent: vi.fn(() => false) });
    finish(signup);
    expect(full.load).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
  });
});
