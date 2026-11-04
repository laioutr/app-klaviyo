import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_FETCH_TIMEOUT_MS, fetchCart, KLAVIYO_CART_QUERY, mapCart } from './klaviyoCart';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const line = (base: object, single = 1999, total = 3998) => ({ components: { base, cost: { single: eur(single), total: eur(total) } } });
const productLine = line({
  type: 'product',
  quantity: 2,
  title: 'Tee',
  code: 'TEE-M',
  link: { type: 'reference', reference: { type: 'Product', id: 'gid://shopify/Product/123' } },
  cover: { sources: [{ src: 'https://cdn.test/tee.jpg' }] },
});
const entity = (items: unknown[], checkoutLink?: unknown) => ({
  components: { base: { totalQuantity: 2, checkoutLink }, cost: { total: eur(3998) } },
  links: { 'ecommerce/cart/cart-items': { entities: items } },
});
const resolveLink = vi.fn((link: any) => (link.type === 'url' ? link.href : '/p/tee'));
const origin = 'https://shop.test';

describe('mapCart', () => {
  it('maps product lines, the total and an absolute product URL', () => {
    expect(mapCart(entity([productLine]), resolveLink, origin)).toStrictEqual({
      value: 39.98,
      items: [
        {
          ProductID: '123',
          SKU: 'TEE-M',
          ProductName: 'Tee',
          Quantity: 2,
          ItemPrice: 19.99,
          RowTotal: 39.98,
          ProductURL: 'https://shop.test/p/tee',
          ImageURL: 'https://cdn.test/tee.jpg',
        },
      ],
    });
  });

  it('excludes discount-code and custom lines', () => {
    const lines = [
      productLine,
      line({ type: 'discount-code', quantity: 1, title: 'SAVE10' }),
      line({ type: 'custom', quantity: 1, title: 'Gift wrap' }),
    ];
    expect(mapCart(entity(lines), resolveLink, origin).items).toHaveLength(1);
  });

  it('falls back to the code when the line has no reference', () => {
    const noLink = line({ type: 'product', quantity: 1, title: 'Tee', code: 'TEE-M' });
    expect(mapCart(entity([noLink]), resolveLink, origin).items[0]!.ProductID).toBe('TEE-M');
  });

  it('keeps an absolute checkout link and makes a relative one absolute', () => {
    const absolute = { type: 'url', href: 'https://checkout.test/abc' };
    expect(mapCart(entity([], absolute), resolveLink, origin).checkoutUrl).toBe('https://checkout.test/abc');
    const relative = { type: 'pageType', pageType: 'checkout' };
    const toPath = () => '/checkout';
    expect(mapCart(entity([], relative), toPath, origin).checkoutUrl).toBe('https://shop.test/checkout');
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('unresolvable');
      },
    ],
    ['returns nothing', () => ''],
  ])('leaves out a link when the resolver %s', (_name, resolver) => {
    const lines = [line({ type: 'product', quantity: 1, title: 'Tee', code: 'X', link: { type: 'url', href: 'x' } })];
    const cart = mapCart(entity(lines, { type: 'url', href: 'x' }), resolver as any, origin);
    expect(cart).not.toHaveProperty('checkoutUrl');
    expect(cart.items[0]).not.toHaveProperty('ProductURL');
  });
});

describe('fetchCart', () => {
  const orchestr = { invalidateQuery: vi.fn(), executeQueries: vi.fn(), getClientQueryResult: vi.fn() };
  const deps = { orchestr, resolveLink, origin };

  beforeEach(() => {
    vi.resetAllMocks();
    resolveLink.mockImplementation((link: any) => (link.type === 'url' ? link.href : '/p/tee'));
    orchestr.executeQueries.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses its own query id and refetches', async () => {
    orchestr.getClientQueryResult.mockReturnValue({ status: 'ok', entities: [entity([productLine])] });
    expect((await fetchCart(deps))?.items).toHaveLength(1);
    expect(KLAVIYO_CART_QUERY.id).toBe('klaviyo-cart');
    expect(orchestr.invalidateQuery).toHaveBeenCalledWith('klaviyo-cart');
    expect(orchestr.invalidateQuery.mock.invocationCallOrder[0]).toBeLessThan(orchestr.executeQueries.mock.invocationCallOrder[0]!);
  });

  it.each([
    ['an error status', { status: 'error' }],
    ['no entity', { status: 'ok', entities: [] }],
  ])('returns undefined on %s', async (_name, result) => {
    orchestr.getClientQueryResult.mockReturnValue(result);
    expect(await fetchCart(deps)).toBeUndefined();
  });

  it('returns undefined when the query rejects', async () => {
    orchestr.executeQueries.mockRejectedValue(new Error('network'));
    expect(await fetchCart(deps)).toBeUndefined();
  });

  it('gives up and aborts after the limit', async () => {
    vi.useFakeTimers();
    orchestr.executeQueries.mockReturnValue(new Promise(() => {}));
    const pending = fetchCart(deps);
    await vi.advanceTimersByTimeAsync(CART_FETCH_TIMEOUT_MS);
    expect(CART_FETCH_TIMEOUT_MS).toBe(3000);
    expect(await pending).toBeUndefined();
    expect((orchestr.executeQueries.mock.calls[0]![1] as AbortSignal).aborted).toBe(true);
  });
});
