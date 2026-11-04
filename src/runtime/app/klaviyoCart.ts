import { compact, type KlaviyoCart, type KlaviyoItem, type MoneyLike, plainId, toMajor } from './klaviyoEvents';
import { CartItemsLink, GetCurrentCartQuery } from '@laioutr-core/canonical-types/ecommerce';
import { CartBase, CartCost } from '@laioutr-core/canonical-types/entity/cart';
import { CartItemBase, CartItemCost } from '@laioutr-core/canonical-types/entity/cart-item';
import { unwrapToken } from '@laioutr-core/core-types/orchestr';
import type { QueryWireRequestQuery } from '#orchestr/types';
import type { Link } from '@laioutr-core/core-types/common';

export const CART_FETCH_TIMEOUT_MS = 3000;

/** The cart sheet's query, under its own id, so a refetch here never disturbs the sheet's result. */
export const KLAVIYO_CART_QUERY = {
  id: 'klaviyo-cart',
  queryName: GetCurrentCartQuery,
  components: [CartBase, CartCost],
  links: {
    [unwrapToken(CartItemsLink)]: {
      components: [CartItemBase, CartItemCost],
    },
  },
} satisfies QueryWireRequestQuery;

export interface CartFetchDeps {
  orchestr: {
    invalidateQuery(queryId: string): void;
    executeQueries(queries: QueryWireRequestQuery[], abortSignal?: AbortSignal): Promise<void>;
    getClientQueryResult(query: QueryWireRequestQuery): { status: string; entities?: unknown[] };
  };
  resolveLink: (link: Link) => string;
  origin: string;
}

interface CartLineEntity {
  components: {
    base: {
      type: string;
      quantity: number;
      title: string;
      code?: string;
      link?: Link;
      cover?: { sources?: { src?: string }[] };
    };
    cost: { single: MoneyLike; total: MoneyLike };
  };
}

interface CartEntity {
  components: {
    base: { checkoutLink?: Link };
    cost?: { total?: MoneyLike };
  };
  links: Record<string, { entities: CartLineEntity[] } | undefined>;
}

/**
 * An address the event can do without must never cost the event, so a bad link is simply left out.
 * That includes an in-page `#` fallback, which is what `linkResolver.resolve` returns for a link it
 * cannot resolve, and which would otherwise reach an email as a working-looking URL.
 */
const toAbsoluteUrl = (link: Link | undefined, resolveLink: CartFetchDeps['resolveLink'], origin: string): string | undefined => {
  if (!link) {
    return undefined;
  }
  try {
    const resolved = resolveLink(link);
    return resolved && !resolved.startsWith('#') ? new URL(resolved, origin).href : undefined;
  } catch {
    return undefined;
  }
};

const toItem = ({ components: { base, cost } }: CartLineEntity, resolveLink: CartFetchDeps['resolveLink'], origin: string): KlaviyoItem => {
  const productId = base.link?.type === 'reference' ? base.link.reference.id : base.code;

  return compact({
    ProductID: productId === undefined ? undefined : plainId(productId),
    SKU: base.code,
    ProductName: base.title,
    Quantity: base.quantity,
    ItemPrice: toMajor(cost.single),
    RowTotal: toMajor(cost.total),
    ProductURL: toAbsoluteUrl(base.link, resolveLink, origin),
    ImageURL: base.cover?.sources?.[0]?.src,
  });
};

export const mapCart = (entity: unknown, resolveLink: CartFetchDeps['resolveLink'], origin: string): KlaviyoCart => {
  const { components, links } = entity as CartEntity;
  const lines = links[unwrapToken(CartItemsLink)]?.entities ?? [];
  const total = components.cost?.total;

  return {
    ...compact({
      value: total ? toMajor(total) : undefined,
      checkoutUrl: toAbsoluteUrl(components.base.checkoutLink, resolveLink, origin),
    }),
    items: lines.filter((line) => line.components.base.type === 'product').map((line) => toItem(line, resolveLink, origin)),
  };
};

/** Never rejects: a cart that cannot be fetched in time must not cost the event that asked for it. */
export const fetchCart = async ({ orchestr, resolveLink, origin }: CartFetchDeps): Promise<KlaviyoCart | undefined> => {
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
    const entity = result.status === 'ok' ? result.entities?.[0] : undefined;
    return entity ? mapCart(entity, resolveLink, origin) : undefined;
  };

  try {
    return await Promise.race([loaded(), timedOut]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};
