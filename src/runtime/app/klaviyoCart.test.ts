import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { createError, readBody } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_FETCH_TIMEOUT_MS, fetchCart } from './klaviyoCart';
import { useOrchestrStore } from '#imports';
import { cartLine, cartStream, noCartStream } from '../../../test/support/orchestr';

let respond: () => unknown;
const requests: { queries: { id: string }[] }[] = [];

registerEndpoint('/api/orchestr/query', {
  method: 'POST',
  handler: async (event) => {
    requests.push(await readBody(event));
    return respond();
  },
});

const productLine = cartLine('line-1', {
  code: 'TEE-M',
  link: { type: 'url', href: 'https://shop.test/p/tee' },
  cover: { sources: [{ src: 'https://cdn.test/tee.jpg' }] },
});

beforeEach(() => {
  requests.length = 0;
});

describe('fetchCart', () => {
  it('maps product lines and the total', async () => {
    respond = () => cartStream([productLine]);
    expect(await fetchCart()).toStrictEqual({
      value: 39.98,
      items: [
        {
          ProductID: 'TEE-M',
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

  it('takes the product id from a reference link', async () => {
    const reference = { type: 'reference', reference: { type: 'Product', id: 'gid://shopify/Product/123', slug: 'tee' } };
    respond = () => cartStream([cartLine('line-1', { code: 'TEE-M', link: reference })]);
    expect((await fetchCart())?.items[0]?.ProductID).toBe('123');
  });

  it('excludes discount-code and custom lines', async () => {
    respond = () =>
      cartStream([
        productLine,
        cartLine('line-2', { type: 'discount-code', title: 'SAVE10' }),
        cartLine('line-3', { type: 'custom', title: 'Gift wrap' }),
      ]);
    expect((await fetchCart())?.items.map((item) => item.ProductName)).toEqual(['Tee']);
  });

  it('keeps an absolute checkout link and makes a relative one absolute', async () => {
    respond = () => cartStream([], { checkoutLink: { type: 'url', href: 'https://checkout.test/abc' } });
    expect((await fetchCart())?.checkoutUrl).toBe('https://checkout.test/abc');

    respond = () => cartStream([], { checkoutLink: { type: 'url', href: '/checkout' } });
    const { checkoutUrl } = (await fetchCart())!;
    expect(new URL(checkoutUrl!).pathname).toBe('/checkout');
  });

  it.each([
    ['cannot be resolved', { type: 'pageType', pageType: 'ecommerce/no-such-page' }],
    ['points inside the page', { type: 'anchor', fragment: 'top' }],
  ])('leaves out a link that %s', async (_name, link) => {
    respond = () => cartStream([cartLine('line-1', { code: 'X', link })], { checkoutLink: link });
    const cart = await fetchCart();
    expect(cart).not.toHaveProperty('checkoutUrl');
    expect(cart?.items[0]).not.toHaveProperty('ProductURL');
  });

  it('uses its own query id and refetches, so a later fetch sees the new cart', async () => {
    respond = () => cartStream([cartLine('line-1', { quantity: 1 })]);
    expect((await fetchCart())?.items[0]?.Quantity).toBe(1);

    respond = () => cartStream([cartLine('line-1', { quantity: 5 })]);
    expect((await fetchCart())?.items[0]?.Quantity).toBe(5);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.queries[0]?.id).toBe('klaviyo-cart');
  });

  it('returns undefined when there is no cart', async () => {
    respond = noCartStream;
    expect(await fetchCart()).toBeUndefined();
  });

  it('returns undefined when the server fails', async () => {
    respond = () => {
      throw createError({ statusCode: 500 });
    };
    expect(await fetchCart()).toBeUndefined();
  });

  describe('when the server does not answer', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('gives up and aborts after the limit', async () => {
      respond = () => new Promise(() => {});
      const execute = vi.spyOn(useOrchestrStore(), 'executeQueries');
      vi.useFakeTimers();

      const pending = fetchCart();
      await vi.advanceTimersByTimeAsync(CART_FETCH_TIMEOUT_MS);

      expect(CART_FETCH_TIMEOUT_MS).toBe(3000);
      expect(await pending).toBeUndefined();
      expect(execute.mock.calls[0]![1]?.aborted).toBe(true);
    });
  });
});
