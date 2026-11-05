import { Money as TsMoney } from '@screeny05/ts-money';
import type { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import type { AnalyticsEventTokenPayloadOf } from '@laioutr-core/core-types/analytics';
import type { Money } from '@laioutr-core/core-types/common';

export type ViewItemPayload = AnalyticsEventTokenPayloadOf<typeof ViewItem>;
export type AddToCartPayload = AnalyticsEventTokenPayloadOf<typeof AddToCart>;
export type BeginCheckoutPayload = AnalyticsEventTokenPayloadOf<typeof BeginCheckout>;
type EventProduct = ViewItemPayload['product'];

export interface KlaviyoItem {
  ProductID?: string;
  SKU?: string;
  ProductName?: string;
  Quantity?: number;
  ItemPrice?: number;
  RowTotal?: number;
  ProductURL?: string;
  ImageURL?: string;
  ProductCategories?: string[];
}

export interface KlaviyoCart {
  value?: number;
  checkoutUrl?: string;
  items: KlaviyoItem[];
}

/**
 * `gid://shopify/Product/123` to `123`, which is what Klaviyo's Hydrogen guide sends. A cart id
 * loses its `?key=` part, so its access key never reaches Klaviyo. Any other value is unchanged.
 */
export const plainId = (value: string): string => {
  if (!value.startsWith('gid://')) {
    return value;
  }
  return value.split('?')[0]!.split('/').pop() || value;
};

export const toMajor = (money: Money): number => TsMoney.from(money).toDecimal();

const toMajorOptional = (money: Money | undefined): number | undefined => (money ? toMajor(money) : undefined);

const isEmpty = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return typeof value === 'object' && value !== null && Object.keys(value).length === 0;
};

/** Absent data is left out rather than sent empty. */
export const compact = <T extends object>(properties: T): Partial<T> =>
  Object.fromEntries(Object.entries(properties).filter(([, value]) => !isEmpty(value))) as Partial<T>;

const toItem = (product: EventProduct): KlaviyoItem => {
  const { price, quantity } = product;

  return compact({
    ProductID: plainId(product.productId),
    SKU: product.sku,
    ProductName: product.name,
    Quantity: quantity,
    ItemPrice: toMajorOptional(price),
    // In minor units, because multiplying decimals drifts.
    RowTotal: price && quantity !== undefined ? toMajor({ amount: price.amount * quantity, currency: price.currency }) : undefined,
    ProductURL: product.url,
    ImageURL: product.imageUrl,
    ProductCategories: product.category,
  });
};

const toItemNames = (items: KlaviyoItem[]): string[] =>
  items.map((item) => item.ProductName).filter((name): name is string => name !== undefined);

export const mapViewedProduct = (
  payload: ViewItemPayload
): { viewedProduct: Record<string, unknown>; viewedItem: Record<string, unknown> } => {
  const { product } = payload;
  const productId = plainId(product.productId);
  // The event's value is the selected variant's price. The product's own is the default variant's.
  const price = toMajorOptional(payload.value ?? product.price);
  const compareAtPrice = toMajorOptional(product.listPrice);

  return {
    viewedProduct: compact({
      ProductName: product.name,
      ProductID: productId,
      SKU: product.sku,
      Categories: product.category,
      ImageURL: product.imageUrl,
      URL: product.url,
      Brand: product.brand,
      Price: price,
      CompareAtPrice: compareAtPrice,
    }),
    viewedItem: compact({
      Title: product.name,
      ItemId: productId,
      Categories: product.category,
      ImageUrl: product.imageUrl,
      Url: product.url,
      Metadata: compact({ Brand: product.brand, Price: price, CompareAtPrice: compareAtPrice }),
    }),
  };
};

/**
 * The event's value belongs to the variant actually added, while the product's own price may be the
 * default variant's. The value only divides cleanly when the event holds one product.
 */
const addedItemPrice = ({ products, value }: AddToCartPayload): number | undefined => {
  const added = products[0];
  if (products.length === 1 && added?.quantity && added.quantity > 0) {
    // In minor units, because dividing decimals drifts: 0.15 / 3 is 0.049999999999999996.
    return toMajor({ amount: Math.round(value.amount / added.quantity), currency: value.currency });
  }
  return toMajorOptional(added?.price);
};

export const mapAddedToCart = (payload: AddToCartPayload, cart?: KlaviyoCart): Record<string, unknown> => {
  const added = payload.products[0];
  // No product lines means the add has not landed yet, so the cart would understate the event.
  const cartItems = cart?.items.length ? cart.items : undefined;
  const items = cartItems ?? payload.products.map(toItem);

  return compact({
    $value: (cartItems ? cart?.value : undefined) ?? toMajor(payload.value),
    AddedItemProductName: added?.name,
    AddedItemProductID: added ? plainId(added.productId) : undefined,
    AddedItemSKU: added?.sku,
    AddedItemCategories: added?.category,
    AddedItemImageURL: added?.imageUrl,
    AddedItemURL: added?.url,
    AddedItemPrice: addedItemPrice(payload),
    AddedItemQuantity: added?.quantity,
    ItemNames: toItemNames(items),
    CheckoutURL: cart?.checkoutUrl,
    Items: items,
  });
};

export const mapStartedCheckout = (eventId: string, payload: BeginCheckoutPayload, checkoutUrl?: string): Record<string, unknown> => {
  const items = payload.products.map(toItem);

  return compact({
    $event_id: eventId,
    $value: toMajor(payload.value),
    ItemNames: toItemNames(items),
    Categories: [...new Set(payload.products.flatMap((product) => product.category ?? []))],
    CheckoutURL: checkoutUrl,
    Items: items,
  });
};
