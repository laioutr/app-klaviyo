# Klaviyo Onsite Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load `klaviyo.js` after consent and send Viewed Product, Added to Cart (with the whole cart) and optionally Started Checkout from canonical events, using only `@laioutr/app-klaviyo`.

**Architecture:** A client-only Nuxt plugin registers a destination on core's analytics bus, as `app-gtm` does. The bus enforces consent, loads the script through `init`, and hands events to pure mapping functions. All logic receives its dependencies as arguments, so unit tests need no Nuxt environment. Only the plugin touches `#imports`.

**Tech Stack:** Nuxt 3 module, TypeScript, Vitest 3, `@screeny05/ts-money`, `@laioutr-core/frontend-core` 0.78, `@laioutr-core/canonical-types` 0.39.

**Spec:** `docs/superpowers/specs/2026-11-04-klaviyo-onsite-tracking-design.md`. Read it first. It holds the reasoning and the known limits.

## Global Constraints

All commands run from the repo root, `/Users/sl/src/app-klaviyo`.

- Change only this repo. `packages/shopify`, `app-shopware`, `shopware-laioutr-integration`, `ui-app` and `frontend-core` do not change.
- Only `src/runtime/app/plugins/klaviyo.client.ts` imports runtime values from `#imports`. Elsewhere use `import type` for `#imports` and `#orchestr/types`, or the unit tests will not load.
- Destination id: `'klaviyo'`. Consent: exactly `{ purposes: ['advertising'] }`. No `filter`. No `onDenied`.
- Metric names, exactly: `'Viewed Product'`, `'Added to Cart'`, `'Started Checkout'`.
- Script URL, exactly: `https://static.klaviyo.com/onsite/js/{companyId}/klaviyo.js`.
- Constants: settle wait `800` ms, cart fetch limit `3000` ms, cart query id `'klaviyo-cart'`.
- Config defaults: `onsiteTracking: true`, `sendStartedCheckout: false`.
- Never `await` or return a `klaviyo.*` call. With a blocked script their promises never resolve, and that would stall the destination's queue.
- Never send phone numbers. Email goes only to `klaviyo.identify`, never onto the analytics bus.
- Run tests with `pnpm vitest run src/runtime/app`. Do not run `pnpm test` locally: it includes `test/basic.test.ts`, which posts a real subscription to a live Klaviyo account. CI runs it as before.
- Commit to the checked-out branch (`main`). Do not create a branch. Do not push. No attribution lines in commit messages.

## Review Focus

Each line's test lives in the named task.

1. Consent withdrawn during the settle wait or cart fetch: the Added to Cart event must not be sent (Task 4).
2. `companyId` typed into the Cockpit with stray spaces, or only spaces: trimmed, and blank counts as missing (Task 4).
3. `AddToCart` with no products, or a quantity of 0: no exception and no `Infinity` in `AddedItemPrice` (Task 1).
4. A cart link the resolver cannot resolve: the event is still sent without that URL (Task 2).
5. A cart fetch that finds no product lines, for example when the add has not landed: `Items` and `$value` come from the event (Task 1).

---

### Task 1: Event mapping

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`
- Create: `src/runtime/app/klaviyoEvents.ts`
- Test: `src/runtime/app/klaviyoEvents.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `klaviyoEvents.ts`:

```ts
interface MoneyLike { amount: number; currency: string }
interface EventProduct {
  productId: string; sku?: string; name?: string; brand?: string;
  price?: MoneyLike; listPrice?: MoneyLike; quantity?: number;
  url?: string; imageUrl?: string; category?: string[];
}
interface KlaviyoItem {
  ProductID?: string; SKU?: string; ProductName?: string; Quantity?: number;
  ItemPrice?: number; RowTotal?: number; ProductURL?: string; ImageURL?: string;
  ProductCategories?: string[];
}
interface KlaviyoCart { value?: number; checkoutUrl?: string; items: KlaviyoItem[] }

plainId(value: string): string
toMajor(money: MoneyLike): number
compact<T extends object>(properties: T): Partial<T>
mapViewedProduct(payload: { product: EventProduct; value?: MoneyLike }):
  { viewedProduct: Record<string, unknown>; viewedItem: Record<string, unknown> }
mapAddedToCart(payload: { products: EventProduct[]; value: MoneyLike }, cart?: KlaviyoCart): Record<string, unknown>
mapStartedCheckout(eventId: string, payload: { products: EventProduct[]; value: MoneyLike }, checkoutUrl?: string): Record<string, unknown>
```

- [ ] **Step 1: Bring `main` up to date and commit the docs**

```bash
git pull --ff-only origin main
git add docs/superpowers
git commit -m "docs: add the Klaviyo onsite tracking spec and plan"
```

Expected: fast-forward succeeds, one commit created.

- [ ] **Step 2: Add the money dependency**

Run: `pnpm add --save-exact @screeny05/ts-money@1.1.0`
Expected: `"@screeny05/ts-money": "1.1.0"` under `dependencies` in `package.json`.

- [ ] **Step 3: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { mapAddedToCart, mapStartedCheckout, mapViewedProduct, plainId, toMajor } from './klaviyoEvents';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const tee = {
  productId: 'gid://shopify/Product/123', sku: 'TEE-M', name: 'Tee', brand: 'Acme',
  price: eur(1999), listPrice: eur(2499), quantity: 2,
  url: 'https://shop.test/p/tee', imageUrl: 'https://cdn.test/tee.jpg', category: ['Men', 'Shirts'],
};
const cap = { productId: '456', name: 'Cap', price: eur(1999), quantity: 1, category: ['Men', 'Hats'] };
const teeItem = {
  ProductID: '123', SKU: 'TEE-M', ProductName: 'Tee', Quantity: 2, ItemPrice: 19.99, RowTotal: 39.98,
  ProductURL: 'https://shop.test/p/tee', ImageURL: 'https://cdn.test/tee.jpg', ProductCategories: ['Men', 'Shirts'],
};
const capItem = { ProductID: '456', ProductName: 'Cap', Quantity: 1, ItemPrice: 19.99, RowTotal: 19.99, ProductCategories: ['Men', 'Hats'] };
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
        ProductName: 'Tee', ProductID: '123', SKU: 'TEE-M', Categories: ['Men', 'Shirts'],
        ImageURL: 'https://cdn.test/tee.jpg', URL: 'https://shop.test/p/tee', Brand: 'Acme',
        Price: 19.99, CompareAtPrice: 24.99,
      },
      viewedItem: {
        Title: 'Tee', ItemId: '123', Categories: ['Men', 'Shirts'],
        ImageUrl: 'https://cdn.test/tee.jpg', Url: 'https://shop.test/p/tee',
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
      AddedItemProductName: 'Tee', AddedItemProductID: '123', AddedItemSKU: 'TEE-M',
      AddedItemCategories: ['Men', 'Shirts'], AddedItemImageURL: 'https://cdn.test/tee.jpg',
      AddedItemURL: 'https://shop.test/p/tee', AddedItemPrice: 19.99, AddedItemQuantity: 2,
      ItemNames: ['Tee', 'Cap'], CheckoutURL: 'https://shop.test/checkout/abc', Items: [teeItem, capItem],
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

  it('survives an event with no products', () => {
    expect(mapAddedToCart({ products: [], value: eur(100) })).toStrictEqual({ $value: 1 });
  });
});

describe('mapStartedCheckout', () => {
  it('maps the event, with unique categories', () => {
    expect(mapStartedCheckout('evt-1', { products: [tee, cap], value: eur(5997) }, 'https://shop.test/checkout')).toStrictEqual({
      $event_id: 'evt-1', $value: 59.97, ItemNames: ['Tee', 'Cap'], Categories: ['Men', 'Shirts', 'Hats'],
      CheckoutURL: 'https://shop.test/checkout', Items: [teeItem, capItem],
    });
  });

  it('leaves out a missing checkout URL', () => {
    expect(mapStartedCheckout('evt-1', { products: [tee], value: eur(3998) })).not.toHaveProperty('CheckoutURL');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/app/klaviyoEvents.test.ts`
Expected: FAIL, cannot resolve `./klaviyoEvents`.

- [ ] **Step 5: Implement `src/runtime/app/klaviyoEvents.ts`**

The Interfaces block and tests determine the rest. Three choices they leave open:

- `toMajor` is `Money.from(money).toDecimal()`, as in `app-gtm`'s `gtmDestination.ts`.
- `compact` drops `undefined`, empty arrays and empty objects.
- Compute `RowTotal` in minor units (`toMajor({ amount: price.amount * quantity, currency })`) to avoid float drift. Leave it out when `price` or `quantity` is absent. `AddedItemPrice` is `toMajor(value) / quantity` only for a single product with `quantity > 0`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/app/klaviyoEvents.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/runtime/app/klaviyoEvents.ts src/runtime/app/klaviyoEvents.test.ts
git commit -m "feat: map canonical events to Klaviyo properties"
```

---

### Task 2: Fetching the cart

**Files:**
- Create: `src/runtime/app/klaviyoCart.ts`
- Test: `src/runtime/app/klaviyoCart.test.ts`

**Interfaces:**
- Consumes: `KlaviyoCart`, `KlaviyoItem`, `plainId`, `toMajor`, `compact` from `klaviyoEvents.ts`.
- Produces, exported from `klaviyoCart.ts`:

```ts
const CART_FETCH_TIMEOUT_MS = 3000
const KLAVIYO_CART_QUERY: QueryWireRequestQuery
interface CartFetchDeps {
  orchestr: {
    invalidateQuery(queryId: string): void;
    executeQueries(queries: QueryWireRequestQuery[], abortSignal?: AbortSignal): Promise<void>;
    getClientQueryResult(query: QueryWireRequestQuery): { status: string; entities?: unknown[] };
  };
  resolveLink: (link: Link) => string;   // Link from '@laioutr-core/core-types/common'
  origin: string;
}
mapCart(entity: unknown, resolveLink: CartFetchDeps['resolveLink'], origin: string): KlaviyoCart
fetchCart(deps: CartFetchDeps): Promise<KlaviyoCart | undefined>   // never rejects
```

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_FETCH_TIMEOUT_MS, fetchCart, KLAVIYO_CART_QUERY, mapCart } from './klaviyoCart';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const line = (base: object, single = 1999, total = 3998) => ({ components: { base, cost: { single: eur(single), total: eur(total) } } });
const productLine = line({
  type: 'product', quantity: 2, title: 'Tee', code: 'TEE-M',
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
      items: [{
        ProductID: '123', SKU: 'TEE-M', ProductName: 'Tee', Quantity: 2, ItemPrice: 19.99, RowTotal: 39.98,
        ProductURL: 'https://shop.test/p/tee', ImageURL: 'https://cdn.test/tee.jpg',
      }],
    });
  });

  it('excludes discount-code and custom lines', () => {
    const lines = [productLine, line({ type: 'discount-code', quantity: 1, title: 'SAVE10' }), line({ type: 'custom', quantity: 1, title: 'Gift wrap' })];
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
    ['throws', () => { throw new Error('unresolvable'); }],
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
  afterEach(() => { vi.useRealTimers(); });

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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/app/klaviyoCart.test.ts`
Expected: FAIL, cannot resolve `./klaviyoCart`.

- [ ] **Step 3: Implement `src/runtime/app/klaviyoCart.ts`**

`KLAVIYO_CART_QUERY` mirrors the query in `ui-app`'s `ConnectedCartSheet.vue`:

```ts
{
  id: 'klaviyo-cart',
  queryName: GetCurrentCartQuery,                 // '@laioutr-core/canonical-types/ecommerce'
  components: [CartBase, CartCost],               // '@laioutr-core/canonical-types/entity/cart'
  links: {
    [unwrapToken(CartItemsLink)]: {               // unwrapToken: '@laioutr-core/core-types/orchestr'
      components: [CartItemBase, CartItemCost],   // '@laioutr-core/canonical-types/entity/cart-item'
    },
  },
}
```

`fetchCart` races `invalidateQuery` + `executeQueries(queries, signal)` against a `CART_FETCH_TIMEOUT_MS` timer using an `AbortController`, clears the timer, and catches everything. A helper resolves a link inside `try/catch`, returning `new URL(resolved, origin).href`, or `undefined` when the resolver throws or returns nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/app/klaviyoCart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app/klaviyoCart.ts src/runtime/app/klaviyoCart.test.ts
git commit -m "feat: fetch the current cart for Klaviyo events"
```

---

### Task 3: Script loading and cookie clearing

**Files:**
- Create: `src/runtime/app/klaviyoScript.ts`
- Test: `src/runtime/app/klaviyoScript.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, exported from `klaviyoScript.ts`:

```ts
interface KlaviyoClient {
  track(name: string, properties?: Record<string, unknown>): unknown;
  trackViewedItem(item: Record<string, unknown>): unknown;
  identify(properties: Record<string, unknown>): unknown;
}
ensureKlaviyo(companyId: string): void   // idempotent
getKlaviyo(): KlaviyoClient              // reads window.klaviyo on every call; klaviyo.js may replace it
clearKlaviyoCookies(): void
```

No DOM environment is installed, so the tests stub `window` and `document` with `vi.stubGlobal`.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKlaviyoCookies, ensureKlaviyo, getKlaviyo } from './klaviyoScript';

const SELECTOR = 'script[src*="static.klaviyo.com/onsite/js/"]';
let appended: any[];
let existing: unknown;
let selectors: string[];
let cookieWrites: string[];
let fakeWindow: any;

beforeEach(() => {
  appended = []; existing = null; selectors = []; cookieWrites = [];
  fakeWindow = { location: { hostname: 'shop.example.com' } };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: { appendChild: (element: unknown) => appended.push(element) },
    querySelector: (selector: string) => { selectors.push(selector); return existing ?? appended[0] ?? null; },
    set cookie(value: string) { cookieWrites.push(value); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('ensureKlaviyo', () => {
  it('inserts the async script with the company id', () => {
    ensureKlaviyo('AbC123');
    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe('https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js');
    expect(appended[0].async).toBe(true);
    expect(selectors).toContain(SELECTOR);
  });

  it('encodes the company id', () => {
    ensureKlaviyo('a b');
    expect(appended[0].src).toBe('https://static.klaviyo.com/onsite/js/a%20b/klaviyo.js');
  });

  it('inserts once however often it runs', () => {
    ensureKlaviyo('AbC123');
    ensureKlaviyo('AbC123');
    expect(appended).toHaveLength(1);
  });

  it('leaves a script that is already on the page alone', () => {
    existing = {};
    ensureKlaviyo('AbC123');
    expect(appended).toHaveLength(0);
  });

  it('leaves an existing klaviyo object alone', () => {
    const client = { track: vi.fn() };
    fakeWindow.klaviyo = client;
    ensureKlaviyo('AbC123');
    expect(fakeWindow.klaviyo).toBe(client);
  });

  it('queues calls until the script runs them, on a promise that stays pending', async () => {
    ensureKlaviyo('AbC123');
    const result = getKlaviyo().track('Viewed Product', { ProductID: '123' });
    expect(fakeWindow._klOnsite[0].slice(0, 3)).toEqual(['track', 'Viewed Product', { ProductID: '123' }]);
    const settled = await Promise.race([result, Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });
});

describe('getKlaviyo', () => {
  it('reads the current object on every call', () => {
    ensureKlaviyo('AbC123');
    const real = { track: vi.fn() };
    fakeWindow.klaviyo = real;
    expect(getKlaviyo()).toBe(real);
  });
});

describe('clearKlaviyoCookies', () => {
  it('expires __kla_id on the host and each parent domain, never the bare TLD', () => {
    clearKlaviyoCookies();
    expect(cookieWrites).toEqual([
      '__kla_id=; Max-Age=0; path=/',
      '__kla_id=; Max-Age=0; path=/; domain=shop.example.com',
      '__kla_id=; Max-Age=0; path=/; domain=example.com',
    ]);
  });

  it('writes host-only for a single-label host', () => {
    fakeWindow.location.hostname = 'localhost';
    clearKlaviyoCookies();
    expect(cookieWrites).toEqual(['__kla_id=; Max-Age=0; path=/']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/app/klaviyoScript.test.ts`
Expected: FAIL, cannot resolve `./klaviyoScript`.

- [ ] **Step 3: Implement `src/runtime/app/klaviyoScript.ts`**

Copy this queue snippet from Klaviyo's docs verbatim. Link `https://developers.klaviyo.com/en/docs/introduction_to_the_klaviyo_object` in a comment above it, and exempt it from Prettier and ESLint. Declare `klaviyo` and `_klOnsite` on the global `Window`.

```js
!function(){if(!window.klaviyo){window._klOnsite=window._klOnsite||[];try{window.klaviyo=new Proxy({},{get:function(n,i){return"push"===i?function(){var n;(n=window._klOnsite).push.apply(n,arguments)}:function(){for(var n=arguments.length,o=new Array(n),w=0;w<n;w++)o[w]=arguments[w];var t="function"==typeof o[o.length-1]?o.pop():void 0,e=new Promise((function(n){window._klOnsite.push([i].concat(o,[function(i){t&&t(i),n(i)}]))}));return e}}})}catch(n){window.klaviyo=window.klaviyo||[],window.klaviyo.push=function(){var n;(n=window._klOnsite).push.apply(n,arguments)}}}}();
```

`ensureKlaviyo` runs the snippet, then inserts the script unless the selector above matches.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/app/klaviyoScript.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app/klaviyoScript.ts src/runtime/app/klaviyoScript.test.ts
git commit -m "feat: load the Klaviyo script and clear its cookie"
```

---

### Task 4: Destination and tracking start

**Files:**
- Create: `src/runtime/app/klaviyoDestination.ts`
- Test: `src/runtime/app/klaviyoDestination.test.ts`

**Interfaces:**
- Consumes: `mapViewedProduct`, `mapAddedToCart`, `mapStartedCheckout`, `plainId`, `KlaviyoCart` (Task 1), `KlaviyoClient` (Task 3). Tokens `ViewItem`, `AddToCart`, `BeginCheckout` from `@laioutr-core/canonical-types/analytics`, and `SubscribeAction` from `@laioutr-core/canonical-types/newsletter`. Tokens are plain strings, so `event.type === ViewItem` works.
- Produces, exported from `klaviyoDestination.ts`:

```ts
const ADD_TO_CART_SETTLE_MS = 800
interface CurrentCustomer { email?: string; person?: { firstName?: string; lastName?: string } }
interface KlaviyoDestinationDeps {
  sendStartedCheckout: boolean;
  load(): void;
  klaviyo(): KlaviyoClient;
  fetchCart(): Promise<KlaviyoCart | undefined>;
  fetchCustomer(): Promise<{ customer: CurrentCustomer }>;
  hasConsent(): boolean;
  clearCookies(): void;
  reload(): void;
}
type KlaviyoDestinationConfig = Omit<AnalyticsDestination, 'stage'>   // import type from '#imports'
createKlaviyoDestination(deps: KlaviyoDestinationDeps): KlaviyoDestinationConfig

interface KlaviyoTrackingConfig { companyId?: string; onsiteTracking?: boolean; sendStartedCheckout?: boolean }
interface ActionFinished { token: unknown; input?: any; output?: any; error?: unknown }
interface KlaviyoTrackingDeps extends Omit<KlaviyoDestinationDeps, 'sendStartedCheckout' | 'load'> {
  load(companyId: string): void;
  register(config: KlaviyoDestinationConfig): void;
  onActionFinished(handler: (args: ActionFinished) => void): void;
  warn(message: string): void;
}
startKlaviyoTracking(config: KlaviyoTrackingConfig, deps: KlaviyoTrackingDeps): void
```

- [ ] **Step 1: Write the failing tests**

```ts
import { AddToCart, BeginCheckout, ViewItem } from '@laioutr-core/canonical-types/analytics';
import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_TO_CART_SETTLE_MS, createKlaviyoDestination, startKlaviyoTracking } from './klaviyoDestination';

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
  return {
    client,
    deps: {
      sendStartedCheckout: false,
      load: vi.fn(),
      klaviyo: () => client,
      fetchCart: vi.fn(async () => cart),
      fetchCustomer: vi.fn(async () => { throw new Error('unauthenticated'); }),
      hasConsent: vi.fn(() => true),
      clearCookies: vi.fn(),
      reload: vi.fn(),
      ...overrides,
    } as any,
  };
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

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
    expect(client.track).toHaveBeenCalledWith('Added to Cart', expect.objectContaining({ $value: 59.97, Items: cart.items, CheckoutURL: cart.checkoutUrl }));
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
    deps.fetchCart.mockImplementation(async () => { deps.hasConsent.mockReturnValue(false); return cart; });
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
    expect(client.track).toHaveBeenCalledWith('Started Checkout', expect.objectContaining({ $event_id: 'evt-9', $value: 19.99, CheckoutURL: cart.checkoutUrl }));
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

    it('does not wait for the customer', async () => {
      const { deps } = makeDeps({ fetchCustomer: vi.fn(() => new Promise(() => {})) });
      await expect(createKlaviyoDestination(deps).init!()).resolves.toBeUndefined();
    });

    it.each([
      ['a guest', async () => { throw new Error('unauthenticated'); }],
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
    const full = { ...deps, register: vi.fn(), warn: vi.fn(), onActionFinished: vi.fn((h: any) => { handler = h; }) };
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

  it.each([[{ onsiteTracking: true }], [{ companyId: '   ', onsiteTracking: true }]])('warns and registers nothing without a company id: %j', (config) => {
    const { full } = start(config);
    expect(full.warn).toHaveBeenCalledOnce();
    expect(full.register).not.toHaveBeenCalled();
  });

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

  it('does not identify a signup without consent', () => {
    const { full, client, finish } = start(on, { hasConsent: vi.fn(() => false) });
    finish(signup);
    expect(full.load).not.toHaveBeenCalled();
    expect(client.identify).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/runtime/app/klaviyoDestination.test.ts`
Expected: FAIL, cannot resolve `./klaviyoDestination`.

- [ ] **Step 3: Implement `src/runtime/app/klaviyoDestination.ts`**

The Interfaces block and tests determine the rest. Three things to get right:

- `init` starts identification without returning or awaiting it. A failure is swallowed, because a rejection only means "not logged in".
- Compare repeat views on `plainId(productId)`. The variable holds the last ID sent and is reset only by a different product.
- Check `hasConsent()` after the settle wait and again after `fetchCart`. The bus only checks eligibility before `track` starts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/runtime/app`
Expected: PASS for all four test files.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app/klaviyoDestination.ts src/runtime/app/klaviyoDestination.test.ts
git commit -m "feat: send canonical events to Klaviyo through an analytics destination"
```

---

### Task 5: Plugin, module, settings and docs

**Files:**
- Create: `src/runtime/app/plugins/klaviyo.client.ts`, `.changeset/klaviyo-onsite-tracking.md`
- Modify: `src/module.ts`, `laioutr.manifest.json`, `README.md`

**Interfaces:**
- Consumes: `startKlaviyoTracking` (Task 4), `ensureKlaviyo`, `getKlaviyo`, `clearKlaviyoCookies` (Task 3), `fetchCart` (Task 2).
- Produces: `runtimeConfig.public['@laioutr/app-klaviyo']` with `companyId`, `onsiteTracking`, `sendStartedCheckout`.

This task is wiring. `pnpm vitest run` does not cover it, so verification is by typecheck and build here, and in a browser in Task 6.

- [ ] **Step 1: Create the plugin**

`runWithContext` is needed because `linkResolver`, `fetchAction` and `useOrchestrStore` call `useNuxtApp()`, and these run long after setup. The Orchestr store is read at fetch time, not during setup, because this plugin may run before Pinia is installed.

```ts
import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app';
import { defineAnalyticsDestination, fetchAction, linkResolver, useAnalytics, useConsentStore, useOrchestrStore } from '#imports';
import { CustomerGetCurrentAction } from '@laioutr-core/canonical-types/ecommerce';
import { fetchCart } from '../klaviyoCart';
import { startKlaviyoTracking } from '../klaviyoDestination';
import { clearKlaviyoCookies, ensureKlaviyo, getKlaviyo } from '../klaviyoScript';

export default defineNuxtPlugin({
  name: 'klaviyo:tracking',
  setup(nuxtApp) {
    const analytics = useAnalytics();
    const consent = useConsentStore();

    startKlaviyoTracking(useRuntimeConfig().public['@laioutr/app-klaviyo'], {
      load: ensureKlaviyo,
      klaviyo: getKlaviyo,
      clearCookies: clearKlaviyoCookies,
      reload: () => window.location.reload(),
      hasConsent: () => consent.hasPurposeConsent('advertising'),
      fetchCart: () =>
        fetchCart({
          orchestr: nuxtApp.runWithContext(() => useOrchestrStore()) as any,
          origin: window.location.origin,
          resolveLink: (link) => nuxtApp.runWithContext(() => linkResolver.resolve(link)) as string,
        }),
      fetchCustomer: () => nuxtApp.runWithContext(() => fetchAction(CustomerGetCurrentAction)) as Promise<any>,
      register: (config) => analytics.register(defineAnalyticsDestination(config)),
      onActionFinished: (handler) => nuxtApp.hook('orchestr:action:fetch:finally' as any, handler),
      warn: (message) => console.warn(message),
    });
  },
});
```

The warning text: `[@laioutr/app-klaviyo] Storefront tracking is on, but no company ID is set. Klaviyo will not load.`

- [ ] **Step 2: Update `src/module.ts`**

- Import `addPlugin` from `@nuxt/kit`.
- `ModuleOptions`: add `onsiteTracking?: boolean` and `sendStartedCheckout?: boolean`, each with a one-line doc comment.
- `RuntimeConfigModulePublic`: `companyId: string; onsiteTracking: boolean; sendStartedCheckout: boolean`. Remove its now-unnecessary empty-interface comment only if ESLint asks.
- `defaults`: add `onsiteTracking: true` and `sendStartedCheckout: false`.
- After the existing private config line, add:

```ts
nuxt.options.runtimeConfig.public[name] = defu(nuxt.options.runtimeConfig.public[name] as Parameters<typeof defu>[0], {
  companyId: options.companyId,
  onsiteTracking: options.onsiteTracking,
  sendStartedCheckout: options.sendStartedCheckout,
} satisfies RuntimeConfigModulePublic);
```

- Under the `// Client` comment, add `addPlugin({ src: resolveRuntimeModule('app/plugins/klaviyo.client'), mode: 'client' });`

- [ ] **Step 3: Update `laioutr.manifest.json`**

Account section description: `The Klaviyo account this environment's storefront sends newsletter sign-ups and visitor activity to.`

`companyId` description: `Klaviyo → Settings → Account → API keys, the six-character public key. Without it, sign-ups and storefront tracking cannot reach Klaviyo.`

Add a second section:

```json
{
  "label": "Storefront tracking",
  "description": "What the storefront sends to Klaviyo from the visitor's browser, once they have accepted marketing cookies.",
  "fields": [
    {
      "name": "onsiteTracking",
      "type": "checkbox",
      "label": "Track visitors on the storefront",
      "default": true,
      "description": "Loads Klaviyo's script for visitors who accept marketing cookies, which enables Klaviyo forms, Viewed Product and Added to Cart. Needs a consent app. Newsletter sign-ups work either way."
    },
    {
      "name": "sendStartedCheckout",
      "type": "checkbox",
      "label": "Send Started Checkout from the storefront",
      "default": false,
      "description": "Turn this on for Shopware. Leave it off for Shopify, where Klaviyo's Shopify integration already sends Checkout Started."
    }
  ]
}
```

- [ ] **Step 4: Update `README.md`**

Mention `klaviyo.js` and the mapped events in the feature list. Add a `## Storefront tracking` section before `## Publishing` with the three lists from the spec's Documentation section, plus the Shopware limits from its Known limits section (guest gap and cart link).

- [ ] **Step 5: Add the changeset**

`.changeset/klaviyo-onsite-tracking.md`:

```md
---
'@laioutr/app-klaviyo': minor
---

Adds storefront tracking. The app now loads Klaviyo's script for visitors who accept marketing cookies, which enables Klaviyo forms, identifies logged-in customers and newsletter sign-ups, and sends Viewed Product and Added to Cart with the whole cart.

The new `onsiteTracking` setting is on by default, so updating starts loading Klaviyo on storefronts already using the app. List Klaviyo in your cookie banner before updating, or turn the setting off. See the README for the Shopify and Shopware setup steps.
```

- [ ] **Step 6: Verify types, lint and build**

Run: `pnpm run dev:prepare && pnpm exec vue-tsc --noEmit && pnpm run lint && pnpm run prepack && ls dist/runtime/app/plugins/`
Expected: no errors, and `klaviyo.client.js` is listed. Fix any error in `src/module.ts` or `src/runtime/app/`, including the new test files. If an error is in a file this plan did not touch, leave it and report it.

- [ ] **Step 7: Run all unit tests**

Run: `pnpm vitest run src/runtime/app`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/runtime/app/plugins/klaviyo.client.ts src/module.ts laioutr.manifest.json README.md .changeset/klaviyo-onsite-tracking.md
git commit -m "feat: enable storefront tracking through a client plugin and Cockpit settings"
```

---

### Task 6: Browser smoke test in the playground

This proves what unit tests cannot: the plugin registers, nothing loads without consent, and the first page view triggers the script. It needs no Klaviyo account. The temporary company ID makes the script request fail or load nothing useful, which doubles as the blocked-script case.

**Files:**
- Temporarily modify, never commit: `playground/nuxt.config.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing. This is verification only.

- [ ] **Step 1: Point the playground at a fake account, with no consent app**

Add to `defineNuxtConfig` in `playground/nuxt.config.ts`:

```ts
'@laioutr/app-klaviyo': { companyId: 'TEST12', defaultNewsletterListId: 'TEST' },
```

- [ ] **Step 2: Start the playground and check that nothing loads**

Run `pnpm dev` in the background. In a browser, open the local URL and evaluate:

```js
[!!document.querySelector('script[src*="static.klaviyo.com/onsite/js/"]'), typeof window.klaviyo]
```

Expected: `[false, "undefined"]`, and no request to `klaviyo.com` in the network log.

- [ ] **Step 3: Grant consent and check that the script loads on the first page**

Add `dev: { consentDebug: true }` to the playground's `laioutr` option, wait for the restart, then do a full reload of the same page without navigating. Evaluate the same expression.

Expected: `[true, "object"]`. The script's `src` is `https://static.klaviyo.com/onsite/js/TEST12/klaviyo.js`. The page still works, and the console shows no `[laioutr:analytics] destination "klaviyo" failed` warning.

- [ ] **Step 4: Turn tracking off and check that nothing loads**

Add `onsiteTracking: false` to the `@laioutr/app-klaviyo` options, wait for the restart and reload.

Expected: `[false, "undefined"]`, even though consent is granted.

- [ ] **Step 5: Restore the playground**

Stop the dev server, then run `git checkout playground/nuxt.config.ts` and `git status --short`.
Expected: `playground/nuxt.config.ts` is not listed, and the working tree is clean.

---

## After the plan

Do not push or release. Report to Sebastian that the code is ready for the manual checks in the spec's Testing section. These need a Klaviyo test account and a Shopify test store, and they must pass before the changeset is merged and released. The ones most likely to change code are whether the standard metric names clash with Klaviyo's Shopify integration, and whether `ProductID` on cart lines matches Klaviyo's catalog.
