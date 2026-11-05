import { compact, type KlaviyoCart, type KlaviyoItem, plainId, toMajor } from './klaviyoEvents';
import { linkResolver, useOrchestrStore } from '#imports';
import { CartItemsLink, GetCurrentCartQuery } from '@laioutr-core/canonical-types/ecommerce';
import { CartBase, CartCost } from '@laioutr-core/canonical-types/entity/cart';
import { CartItemBase, CartItemCost } from '@laioutr-core/canonical-types/entity/cart-item';
import { unwrapToken } from '@laioutr-core/core-types/orchestr';
import type { ClientEntityTyped, QueryWireRequestQuery } from '#orchestr/types';
import type { Link } from '@laioutr-core/core-types/common';

export const CART_FETCH_TIMEOUT_MS = 3000;

/** The cart sheet's query, under its own id, so a refetch here never disturbs the sheet's result. */
const KLAVIYO_CART_QUERY = {
  id: 'klaviyo-cart',
  queryName: GetCurrentCartQuery,
  components: [CartBase, CartCost],
  links: {
    [unwrapToken(CartItemsLink)]: {
      components: [CartItemBase, CartItemCost],
    },
  },
} satisfies QueryWireRequestQuery;

type CartEntity = ClientEntityTyped<typeof KLAVIYO_CART_QUERY>;
type CartLineEntity = CartEntity['links'][keyof CartEntity['links']]['entities'][number];

/**
 * An address the event can do without must never cost the event, so a link that does not resolve is
 * left out. Only an absolute one is any use in an email, which rules out an anchor's `#…` as well.
 */
const toAbsoluteUrl = (link: Link | undefined): string | undefined => {
  if (!link) {
    return undefined;
  }
  try {
    const resolved = linkResolver.resolveOrThrow(link, { withOrigin: true });
    return /^https?:\/\//.test(resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
};

const toItem = ({ components: { base, cost } }: CartLineEntity): KlaviyoItem => {
  const productId = base.link?.type === 'reference' ? base.link.reference.id : base.code;

  return compact({
    ProductID: productId === undefined ? undefined : plainId(productId),
    SKU: base.code,
    ProductName: base.title,
    Quantity: base.quantity,
    ItemPrice: toMajor(cost.single),
    RowTotal: toMajor(cost.total),
    ProductURL: toAbsoluteUrl(base.link),
    ImageURL: base.cover?.sources?.[0]?.src,
  });
};

const mapCart = ({ components, links }: CartEntity): KlaviyoCart => {
  const lines = links[unwrapToken(CartItemsLink)]?.entities ?? [];
  const total = components.cost?.total;

  return {
    ...compact({
      value: total ? toMajor(total) : undefined,
      checkoutUrl: toAbsoluteUrl(components.base.checkoutLink),
    }),
    items: lines.filter((line) => line.components.base.type === 'product').map((line) => toItem(line)),
  };
};

/**
 * Never rejects: a cart that cannot be fetched in time must not cost the event that asked for it.
 * Like `fetchAction`, it reads its composables before its first await, so a caller outside a Nuxt
 * context starts it with `nuxt.runWithContext`.
 */
export const fetchCart = async (): Promise<KlaviyoCart | undefined> => {
  const orchestr = useOrchestrStore();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(undefined);
    }, CART_FETCH_TIMEOUT_MS);
  });

  const loaded = async () => {
    orchestr.invalidateQuery(KLAVIYO_CART_QUERY.id);
    await orchestr.executeQueries([KLAVIYO_CART_QUERY], controller.signal);
    const result = orchestr.getClientQueryResult(KLAVIYO_CART_QUERY);
    const entity = result.status === 'ok' ? (result.entities?.[0] as CartEntity | undefined) : undefined;
    return entity ? mapCart(entity) : undefined;
  };

  try {
    return await Promise.race([loaded(), timedOut]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};
