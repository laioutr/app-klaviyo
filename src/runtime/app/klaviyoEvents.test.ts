import { describe, expect, it } from 'vitest';
import { mapAddedToCart, mapStartedCheckout, mapViewedProduct, plainId, toMajor } from './klaviyoEvents';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const tee = {
  productId: 'gid://shopify/Product/123',
  sku: 'TEE-M',
  name: 'Tee',
  brand: 'Acme',
  price: eur(1999),
  listPrice: eur(2499),
  quantity: 2,
  url: 'https://shop.test/p/tee',
  imageUrl: 'https://cdn.test/tee.jpg',
  category: ['Men', 'Shirts'],
};
const cap = { productId: '456', name: 'Cap', price: eur(1999), quantity: 1, category: ['Men', 'Hats'] };
const teeItem = {
  ProductID: '123',
  SKU: 'TEE-M',
  ProductName: 'Tee',
  Quantity: 2,
  ItemPrice: 19.99,
  RowTotal: 39.98,
  ProductURL: 'https://shop.test/p/tee',
  ImageURL: 'https://cdn.test/tee.jpg',
  ProductCategories: ['Men', 'Shirts'],
};
const capItem = {
  ProductID: '456',
  ProductName: 'Cap',
  Quantity: 1,
  ItemPrice: 19.99,
  RowTotal: 19.99,
  ProductCategories: ['Men', 'Hats'],
};
const cart = { value: 59.97, checkoutUrl: 'https://shop.test/checkout/abc', items: [teeItem, capItem] };

describe('plainId', () => {
  it.each([
    ['gid://shopify/Product/123', '123'],
    ['gid://shopify/Cart/abc?key=secret', 'abc'],
    ['0189f3a2c4', '0189f3a2c4'],
    ['a/b?c=d', 'a/b?c=d'],
  ])('%s becomes %s', (input, output) => expect(plainId(input)).toBe(output));
});

describe('toMajor', () => {
  it('uses the currency exponent', () => {
    expect(toMajor(eur(1999))).toBe(19.99);
    expect(toMajor({ amount: 1500, currency: 'JPY' })).toBe(1500);
  });
});

describe('mapViewedProduct', () => {
  it('maps every field', () => {
    expect(mapViewedProduct({ product: tee })).toStrictEqual({
      viewedProduct: {
        ProductName: 'Tee',
        ProductID: '123',
        SKU: 'TEE-M',
        Categories: ['Men', 'Shirts'],
        ImageURL: 'https://cdn.test/tee.jpg',
        URL: 'https://shop.test/p/tee',
        Brand: 'Acme',
        Price: 19.99,
        CompareAtPrice: 24.99,
      },
      viewedItem: {
        Title: 'Tee',
        ItemId: '123',
        Categories: ['Men', 'Shirts'],
        ImageUrl: 'https://cdn.test/tee.jpg',
        Url: 'https://shop.test/p/tee',
        Metadata: { Brand: 'Acme', Price: 19.99, CompareAtPrice: 24.99 },
      },
    });
  });

  it('prefers the event value, which is the selected variant', () => {
    const { viewedProduct, viewedItem } = mapViewedProduct({ product: tee, value: eur(1799) });
    expect(viewedProduct.Price).toBe(17.99);
    expect((viewedItem.Metadata as any).Price).toBe(17.99);
  });

  it('leaves absent and empty fields out', () => {
    expect(mapViewedProduct({ product: { productId: 'abc', category: [] } })).toStrictEqual({
      viewedProduct: { ProductID: 'abc' },
      viewedItem: { ItemId: 'abc' },
    });
  });
});

describe('mapAddedToCart', () => {
  const payload = { products: [tee], value: eur(3998) };

  it('sends the whole cart', () => {
    expect(mapAddedToCart(payload, cart)).toStrictEqual({
      $value: 59.97,
      AddedItemProductName: 'Tee',
      AddedItemProductID: '123',
      AddedItemSKU: 'TEE-M',
      AddedItemCategories: ['Men', 'Shirts'],
      AddedItemImageURL: 'https://cdn.test/tee.jpg',
      AddedItemURL: 'https://shop.test/p/tee',
      AddedItemPrice: 19.99,
      AddedItemQuantity: 2,
      ItemNames: ['Tee', 'Cap'],
      CheckoutURL: 'https://shop.test/checkout/abc',
      Items: [teeItem, capItem],
    });
  });

  it('falls back to the event without a cart', () => {
    const mapped = mapAddedToCart(payload);
    expect(mapped.$value).toBe(39.98);
    expect(mapped.Items).toStrictEqual([teeItem]);
    expect(mapped.ItemNames).toStrictEqual(['Tee']);
    expect(mapped).not.toHaveProperty('CheckoutURL');
  });

  it('falls back to the event when the cart has no product lines', () => {
    const mapped = mapAddedToCart(payload, { value: 0, items: [] });
    expect(mapped.$value).toBe(39.98);
    expect(mapped.Items).toStrictEqual([teeItem]);
  });

  it('derives the price from value and quantity, not the default variant', () => {
    expect(mapAddedToCart({ products: [tee], value: eur(5000) }, cart).AddedItemPrice).toBe(25);
  });

  it.each([
    ['several products', { products: [tee, cap], value: eur(5997) }],
    ['a quantity of 0', { products: [{ ...tee, quantity: 0 }], value: eur(0) }],
    ['no quantity', { products: [{ ...tee, quantity: undefined }], value: eur(3998) }],
  ])('uses the product price with %s', (_name, input) => {
    expect(mapAddedToCart(input).AddedItemPrice).toBe(19.99);
  });

  it('divides in minor units, so the price carries no float drift', () => {
    expect(mapAddedToCart({ products: [{ ...tee, quantity: 3 }], value: eur(15) }).AddedItemPrice).toBe(0.05);
  });

  it('survives an event with no products', () => {
    expect(mapAddedToCart({ products: [], value: eur(100) })).toStrictEqual({ $value: 1 });
  });
});

describe('mapStartedCheckout', () => {
  it('maps the event, with unique categories', () => {
    expect(mapStartedCheckout('evt-1', { products: [tee, cap], value: eur(5997) }, 'https://shop.test/checkout')).toStrictEqual({
      $event_id: 'evt-1',
      $value: 59.97,
      ItemNames: ['Tee', 'Cap'],
      Categories: ['Men', 'Shirts', 'Hats'],
      CheckoutURL: 'https://shop.test/checkout',
      Items: [teeItem, capItem],
    });
  });

  it('leaves out a missing checkout URL', () => {
    expect(mapStartedCheckout('evt-1', { products: [tee], value: eur(3998) })).not.toHaveProperty('CheckoutURL');
  });
});
