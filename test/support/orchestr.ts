import { encode } from 'turbo-stream';
import { CartItemsLink } from '@laioutr-core/canonical-types/ecommerce';
import { unwrapToken } from '@laioutr-core/core-types/orchestr';

/** The server's response format, so the real `fetchAction` and store decode it as they do in production. */
export const orchestrStream = (value: unknown) => encode(value).pipeThrough(new TextEncoderStream());

const CART_ITEMS = unwrapToken(CartItemsLink);

export const eur = (amount: number) => ({ amount, currency: 'EUR' });

export const cartLine = (id: string, base: object, single = 1999, total = 3998) => ({
  id,
  components: { base: { type: 'product', quantity: 2, title: 'Tee', ...base }, cost: { single: eur(single), total: eur(total) } },
});

/** The chunk order a real cart response uses: the id, the cart, its line ids, then the lines. */
export const cartStream = (lines: ReturnType<typeof cartLine>[], base: object = {}, total = 3998) =>
  orchestrStream(
    (async function* () {
      yield { type: 'queryResult', id: 'klaviyo-cart', entityType: 'Cart', entityIds: ['cart-1'], entityTotal: 1, limit: 1 };
      yield {
        type: 'entity',
        entityType: 'Cart',
        id: 'cart-1',
        components: { base: { totalQuantity: 2, ...base }, cost: { total: eur(total) } },
      };
      yield {
        type: 'linkCollection',
        sourceEntityType: 'Cart',
        sourceQueryPath: ['klaviyo-cart', CART_ITEMS],
        linkName: CART_ITEMS,
        targetEntityType: 'CartItem',
        links: [{ sourceId: 'cart-1', targetIds: lines.map((line) => line.id), entityTotal: lines.length }],
      };
      for (const line of lines) {
        yield { type: 'entity', entityType: 'CartItem', ...line };
      }
    })()
  );

/** What a guest gets: `GetCurrentCartQuery` answers with no id when there is no cart. */
export const noCartStream = () =>
  orchestrStream(
    (async function* () {
      yield { type: 'queryResult', id: 'klaviyo-cart', entityType: 'Cart', entityIds: [], entityTotal: 0, limit: 1 };
    })()
  );
