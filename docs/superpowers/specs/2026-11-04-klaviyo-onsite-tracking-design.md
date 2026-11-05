# Klaviyo onsite tracking (Design)

Status: awaiting review
Repo: `@laioutr/app-klaviyo`

## Goal

Load Klaviyo's onsite script (`klaviyo.js`) on storefronts that use this app, so that Klaviyo forms work, visitors get identified, and Viewed Product and Added to Cart reach Klaviyo for browse and cart abandonment flows.

Today the app only subscribes visitors to a newsletter from the server. It has no browser code.

Rollout is Shopify first. Shopware works through setup and one setting.

### Success criteria

- Nothing from Klaviyo loads or runs in the browser before the visitor grants `advertising` consent.
- A test profile shows Active on Site, Viewed Product and Added to Cart, with correct product data and the whole cart.
- Withdrawing consent stops tracking.

### Constraints

- **No Klaviyo code in the ecommerce apps.** `packages/shopify`, `app-shopware` and `shopware-laioutr-integration` do not change. Nor do `ui-app` and `frontend-core`. This app uses canonical events, queries and actions only.
- **Klaviyo's own integrations send orders.** Placed Order requires a server and a private key, so this app does not send it. On Shopify that is Klaviyo's Shopify integration, and on Shopware Klaviyo's Shopware extension.

### Non-goals

- Sending Placed Order or any other server-side event.
- Closing the Shopware guest gap (see Known limits).
- A different consent rule for forms than for tracking.
- Per-market Klaviyo accounts. One `companyId` applies per environment, as it does today.

## Who sends what

| Metric | Shopify | Shopware |
| --- | --- | --- |
| Active on Site | `klaviyo.js`, loaded by this app | `klaviyo.js`, loaded by this app |
| Viewed Product | this app | this app |
| Added to Cart | this app | this app |
| Started / Checkout Started | Klaviyo's integration, as Checkout Started | this app, as Started Checkout |
| Placed Order | Klaviyo's integration | Klaviyo's extension |

## Architecture

A client-only plugin registers an analytics destination on core's bus, the pattern `app-gtm` uses. The destination receives canonical events only after consent, loads the script on first delivery and maps events to Klaviyo calls.

| File | Responsibility |
| --- | --- |
| `src/runtime/app/plugins/klaviyo.client.ts` | Starts tracking with the module's public config. |
| `src/runtime/app/klaviyoDestination.ts` | The destination: `init`, `track`, `teardown`, and repeat-view skipping. `startKlaviyoTracking` holds the config checks, the registration and the `SubscribeAction` hook. Calls its collaborators directly. |
| `src/runtime/app/klaviyoEvents.ts` | Pure functions from canonical payloads to Klaviyo properties, including ID and money conversion. |
| `src/runtime/app/klaviyoCart.ts` | Fetches the current cart through `GetCurrentCartQuery` and maps it to a plain object. |
| `src/runtime/app/klaviyoScript.ts` | Queue snippet, script insertion, cookie clearing. |

Rejected alternatives:

- **Server-side subscriber, like Shopify's Monorail forwarder.** There would be no forms, and Klaviyo ties anonymous visitors to its own browser cookie, so events could not reach the right person. `docs/plans/2026-07-13-canonical-event-vocabulary-design.md` in the monorepo reached the same conclusion.
- **Script loaded separately from the destination.** This adds a second consent code path, and would only pay off if forms followed different rules from tracking.

## Script and consent

**Registration.** The plugin does nothing unless `onsiteTracking` is true and `companyId` is set. If tracking is on and `companyId` is missing, it logs a warning.

**Destination.** `id: 'klaviyo'`, `consent: { purposes: ['advertising'] }`, built with `defineAnalyticsDestination`.

- `advertising` because Klaviyo uses this data for marketing email, and adapters such as Cookiebot's map their marketing category to it. It is fixed in code. A visitor who accepts statistics but not marketing gets GTM and not Klaviyo.
- Forms follow the same rule, because they load with the same script.
- A storefront with no consent adapter never loads Klaviyo, because consent state defaults to denied.
- There is no `onDenied`, so no event reaches Klaviyo without consent.

**No `filter`.** The delivery queue checks `filter` before `init`. A filter limited to commerce events would delay the script, and forms with it, until the first product view. `track` ignores events it does not map, so the first page view triggers the load.

**Loading.** `init` calls an idempotent `ensureKlaviyo()`, which:

1. Installs Klaviyo's queue snippet, copied from their docs and linked in a comment, unless `window.klaviyo` already exists.
2. Inserts `<script async src="https://static.klaviyo.com/onsite/js/{companyId}/klaviyo.js">`, unless a script from `static.klaviyo.com/onsite/js/` is already on the page. Klaviyo warns that duplicates can break tracking.

Nothing goes in the server-rendered head, because consent is not known at that point. `init` does not wait for the script to load.

**Blocked script.** With an ad blocker, Klaviyo's queue never runs and its promises never resolve. The app therefore never awaits a `klaviyo.*` call, otherwise the destination's serial queue would stall.

**Withdrawal.** The bus calls `teardown` when eligibility is lost. If the script was loaded and `advertising` is no longer granted, `teardown` deletes `__kla_id` for the current host and its parent domains, then reloads the page.

- Klaviyo documents that a loaded tracker stops only on reload. After the reload, the bus does not load the script again, so the `__kla_off` opt-out cookie is not needed.
- The consent check guards against a reload when `teardown` runs for another reason, such as the bus unregistering the destination.
- A visitor withdrawing consent loses unsaved input on that page.

## Event mapping

| Core event | Klaviyo call | Rule |
| --- | --- | --- |
| `ViewItem` | `track('Viewed Product', …)` and `trackViewedItem(…)` | Skip when `ProductID` equals the last one sent. Core re-fires on every variant switch. Viewing A, then B, then A again sends three times. |
| `AddToCart` | `track('Added to Cart', …)` | Includes quantity increases in the cart sheet. |
| `BeginCheckout` | `track('Started Checkout', …)` | Only when `sendStartedCheckout` is true. |

All other events are ignored, including `PageView` and `RemoveFromCart`.

Common rules:

- **IDs.** A value starting with `gid://` becomes its last path segment without the query string, so `gid://shopify/Product/123` becomes `123`. Other values pass through. Klaviyo's Hydrogen guide does the same. `analyticsIds.stripGidPrefix` is not used because it is not a Cockpit setting, is easy to forget and changes the IDs GTM receives. If a shop has it on, this step does nothing.
- **Money.** Minor units become decimals with `Money.from(money).toDecimal()` from `@screeny05/ts-money`, as in `app-gtm`.
- **Missing data.** Absent fields are left out, not sent empty.

### Viewed Product

| Klaviyo | Source |
| --- | --- |
| `ProductName` | `product.name` |
| `ProductID` | `product.productId` |
| `SKU` | `product.sku` |
| `Categories` | `product.category` |
| `ImageURL` | `product.imageUrl` |
| `URL` | `product.url` |
| `Brand` | `product.brand` |
| `Price` | event `value`, else `product.price`. The event's value is the selected variant's price, while the projection reports the default variant. |
| `CompareAtPrice` | `product.listPrice` |

`trackViewedItem` receives the same data as `Title`, `ItemId`, `Categories`, `ImageUrl`, `Url` and `Metadata: { Brand, Price, CompareAtPrice }`.

### Added to Cart

| Klaviyo | Source |
| --- | --- |
| `AddedItemProductName`, `AddedItemProductID`, `AddedItemSKU`, `AddedItemCategories`, `AddedItemImageURL`, `AddedItemURL`, `AddedItemQuantity` | First entry of the event's `products` |
| `AddedItemPrice` | `value / quantity` for a single-product event, else `product.price`. The product page event reports the default variant's price but the selected variant's `value`. |
| `$value` | Cart total, else the event's `value` |
| `Items`, `ItemNames` | Cart lines, else the event's `products` |
| `CheckoutURL` | Cart `checkoutLink`, omitted when absent |

### Started Checkout

| Klaviyo | Source |
| --- | --- |
| `$event_id` | The core event's `id`. It is unique and stays the same if the event is replayed. |
| `$value` | Event `value` |
| `Items`, `ItemNames`, `Categories` | The event's `products`, which is already the whole cart |
| `CheckoutURL` | Cart `checkoutLink`, omitted when absent |

### Items entries

| Klaviyo | From a cart line | From an event product |
| --- | --- | --- |
| `ProductID` | Reference ID of `base.link`, else `base.code` | `productId` |
| `SKU` | `base.code` | `sku` |
| `ProductName` | `base.title` | `name` |
| `Quantity` | `base.quantity` | `quantity` |
| `ItemPrice` | `cost.single` | `price` |
| `RowTotal` | `cost.total` | `price` × `quantity` |
| `ProductURL` | `base.link`, resolved to an absolute URL | `url` |
| `ImageURL` | `base.cover.sources[0].src` | `imageUrl` |
| `ProductCategories` | Not available | `category` |

## Fetching the cart

Core's `AddToCart` event carries only the added items. The whole cart is not added to that event because:

- `app-gtm` forwards unknown payload fields, so it would appear in every GTM `add_to_cart` push.
- The product page and product tile do not hold the cart, so storefronts without Klaviyo would pay for a fetch or need a new shared cart store.
- The rules in `.claude/skills/adding-event-tokens/SKILL.md` keep a single vendor's needs out of canonical events until others want the same thing.

Instead `klaviyoCart.ts` runs the query the cart sheet uses, under its own query ID (`klaviyo-cart`): `invalidateQuery`, `executeQueries`, then `getClientQueryResult`. It requests `CartBase` and `CartCost`, plus `CartItemBase` and `CartItemCost` on `CartItemsLink`. Only lines with `base.type === 'product'` become `Items`. Links go through `linkResolver.resolveOrThrow(link, { withOrigin: true })`, as core's `entityAddressOf` does, so an unresolvable link is left out instead of becoming the in-page `#unknown-route` fallback that `resolve` returns.

**Settle wait.** The cart sheet fires `AddToCart` about 500 ms before it saves a quantity change. The destination therefore waits 800 ms before fetching on `AddToCart`. `BeginCheckout` fetches without a wait, because the cart is not changing.

**Failure.** The fetch is limited to 3 seconds. On an error, timeout or empty result, the event is still sent, built from its own payload.

**Cost.** One extra cart request per add, and one per checkout start where `sendStartedCheckout` is on, only for consented visitors on stores with this app. Other destinations have their own queues, so they are not held up.

## Identification

Klaviyo only records Added to Cart for a visitor it knows, so this decides how many cart events count.

**Logged-in customers.** After `ensureKlaviyo()`, once per full page load, the destination calls `CustomerGetCurrentAction` without blocking `init`. If it returns an email, it calls `klaviyo.identify` with `email`, `first_name` and `last_name`.

- A rejection means "not logged in" and is ignored, as in `SectionProductReviews.vue`.
- Core's OAuth login leaves the storefront and returns with a full page load, so login needs no extra code.
- `klaviyo.isIdentified()` is not used to skip the call. Otherwise, on a shared computer, the second person to log in would stay identified as the first.

**Newsletter signups.** The plugin hooks `orchestr:action:fetch:finally`. When `token` is `SubscribeAction`, there is no error, `output.status` is `success` or `already-subscribed`, and `advertising` is granted, it calls `ensureKlaviyo()` and `klaviyo.identify({ email: input.email })`. Without that consent, the signup still subscribes as it does today, but does not identify the browser.

**What is not sent.**

- Phone numbers, to keep personal data to what is needed.
- Marketing subscription status. Cookie consent is never passed on as a subscription.
- Email on the analytics bus. It goes only to `klaviyo.identify`.

## Configuration

New "Storefront tracking" section in `laioutr.manifest.json`:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `onsiteTracking` | checkbox | `true` | Loads the script, forms and events. Newsletter signups work either way. |
| `sendStartedCheckout` | checkbox | `false` | Turn on for Shopware. Leave off on Shopify, where Klaviyo's integration sends Checkout Started. |

The app stays independent of the shop system: the difference is this setting, not code.

The `companyId` field description is updated, as it currently only mentions newsletter sign-ups.

`src/module.ts`:

- Adds both options with these defaults.
- Fills `RuntimeConfigModulePublic` with `companyId`, `onsiteTracking` and `sendStartedCheckout`. `companyId` is Klaviyo's public API key, so it is safe in public config. It also stays in private config for the server SDK.
- Registers the plugin with `mode: 'client'`.

## Documentation

README setup steps:

- **All shops:** a consent app is required, or Klaviyo never loads. List Klaviyo as a marketing cookie in the banner.
- **Shopify:** keep Klaviyo's Shopify integration connected for orders. Check that nothing else loads `klaviyo.js`. Ask Klaviyo support to point catalog URLs at the storefront domain instead of `myshopify.com`.
- **Shopware:** install Klaviyo's extension with order metrics on and onsite metrics off. Connect one sales channel. Turn on `sendStartedCheckout`. The limits below are documented here.

## Testing

**Unit tests**, next to each file under `src/runtime/app/`, in the Nuxt environment with `defineVitestConfig` and the playground as `rootDir`, as `app-gtm` does. They use the real consent store, analytics bus, orchestr store, link resolver and hook, as `.claude/rules/nuxt-testing-over-abstraction.md` requires. Only the absent server is replaced, through `registerEndpoint`. Happy DOM's script loading is off, so no test runs Klaviyo's real script or sends it anything.

- Mapping for all three events, with absent fields left out.
- ID stripping for gids, cart gids with `?key=`, and non-gid values.
- Money conversion, and `AddedItemPrice` from `value / quantity`.
- Repeat product views skipped, and A, B, A sends three times.
- Cart fetch: settle wait on `AddToCart`, none on `BeginCheckout`, discount-code lines excluded, fallback on failure and timeout.
- `sendStartedCheckout` off and on.
- Script inserted once, and not inserted when one is already present.
- `klaviyo.*` calls never awaited, so a queue that never resolves does not stall delivery.
- `teardown`: deletes the cookie and reloads when consent is gone, does nothing when it is still granted or the script never loaded.
- Identify: customer with email, rejection, customer without email, `SubscribeAction` with and without consent.
- Plugin does nothing when `onsiteTracking` is off or `companyId` is missing.

**Manual check before release**, on a Klaviyo test account and a Shopify test store:

- No Klaviyo requests before consent.
- The script loads on the first page after consent, which confirms the page view triggers `init` on a first load.
- Active on Site, Viewed Product and Added to Cart appear on a test profile, with the whole cart.
- `ProductID` on events and cart lines matches Klaviyo's catalog. Cart lines take their ID from a reference link that may not be the product itself.
- The standard metric names do not clash with Klaviyo's Shopify integration. Klaviyo's Hydrogen guide uses `Hydrogen Viewed Product` without saying why.
- `identify` alone does not subscribe anyone.
- Withdrawing consent stops tracking.
- URL-targeted forms behave after in-app navigation. Klaviyo's docs do not cover this.

**Manual check for Shopware**, before the first Shopware customer:

- Order metrics can stay on with onsite metrics off. Klaviyo's docs describe no dedicated switch.
- The extension does not track inside the checkout frame.
- Whether the Started Checkout link brings the cart back.

## Release

- Minor version bump with a changeset.
- Add `@screeny05/ts-money` as a dependency, at the version `app-gtm` uses.
- The changeset states that `onsiteTracking` defaults to on, so updating starts loading Klaviyo for visitors who grant `advertising` consent, on storefronts already using the app. Merchants should list Klaviyo in their cookie banner, or turn the setting off, before updating.

## Known limits

- **Shopware guest gap.** Klaviyo lists Started Checkout as an onsite event on Shopware, and this app cannot see an email typed into the checkout frame. A first-time guest who abandons there stays unknown to Klaviyo, so no email goes out. Logged-in customers and visitors Klaviyo already knows are unaffected. Accepted for now. Closing it would mean passing consent into the frame, which changes `app-shopware` and `shopware-laioutr-integration`.
- **Shopware cart link.** `checkoutLink` points at the checkout page, so an email link may not restore the cart, for example on another device.
- **Cart quantity.** On a very slow connection, a quantity change in the cart sheet may not be saved within the settle wait, so `Items` can show the previous quantity.
- **Lost events.** A full-page move to checkout within the settle wait loses that Added to Cart.
- **Categories.** Cart lines carry none, so `ProductCategories` is empty for them.
- **Currency.** `$value` has no currency in Klaviyo, so a multi-currency shop sends each number as it is.
- **Logout.** Core has no logout signal today, so someone who logs out stays identified in that browser until another customer logs in.
- **In-page login.** A login without a page load, such as inside Shopware's checkout frame, is picked up on the next full load.
- **`__kle_id`.** Klaviyo's First-party ID feature sets this cookie from the server, and it can restore `__kla_id`. The browser may not be able to delete it, so it is documented and not handled.

## Sources

- [Klaviyo JavaScript API](https://developers.klaviyo.com/en/docs/javascript_api)
- [Introduction to the klaviyo object](https://developers.klaviyo.com/en/docs/introduction_to_the_klaviyo_object)
- [Integrate a platform without a pre-built Klaviyo integration](https://developers.klaviyo.com/en/docs/guide_to_integrating_a_platform_without_a_pre_built_klaviyo_integration)
- [Integrate with a Shopify Hydrogen store](https://developers.klaviyo.com/en/docs/integrate_with_a_shopify_hydrogen_store)
- [Understanding cookies in Klaviyo](https://help.klaviyo.com/hc/en-us/articles/360034666712)
- [Getting started with Shopware 6](https://help.klaviyo.com/hc/en-us/articles/13001662470939-Getting-started-with-Shopware-6)
- [How to create an abandoned cart flow for Shopware 6](https://help.klaviyo.com/hc/en-us/articles/13323494909083-How-to-create-an-abandoned-cart-flow-for-Shopware-6)
