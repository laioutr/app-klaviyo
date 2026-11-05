# Changelog

## 1.4.0

### Minor Changes

- c321a54: Adds storefront tracking. The app now loads Klaviyo's script for visitors who accept marketing cookies, which enables Klaviyo forms, identifies logged-in customers and newsletter sign-ups, and sends Viewed Product and Added to Cart with the whole cart.

  The new `onsiteTracking` setting is on by default, so updating starts loading Klaviyo on storefronts already using the app. List Klaviyo in your cookie banner before updating, or turn the setting off. See the README for the Shopify and Shopware setup steps.

## 1.3.2

### Patch Changes

- 20635a4: Records the app with the Cockpit, so the Klaviyo settings appear under the environment's Configuration. The Cockpit recorded neither 1.3.0 nor 1.3.1, so their settings never arrived. The code is unchanged.

## 1.3.1

### Patch Changes

- 1275e1f: Registers the app with the Cockpit, so the Klaviyo settings appear under the environment's Configuration. The Cockpit refused the 1.3.0 release, so its settings never arrived. The code is unchanged.

## 1.3.0

### Minor Changes

- 798ef03: The Klaviyo company ID, newsletter list ID and API address can now be set per environment in the Cockpit, under the environment's Configuration, instead of in nuxt.config.
- 798ef03: The app no longer installs its own `@laioutr-core/frontend-core`, `@laioutr-core/canonical-types` and `@laioutr-core/kit`, which put a second core next to the project's. They are peer dependencies now: `frontend-core`, `core-types` and `kit` from 0.78.0, `canonical-types` from 0.39.10.

## v1.1.1

[compare changes](https://github.com/laioutr/app-klaviyo/compare/v1.1.1...v1.1.1)

## v1.1.0

### 🚀 Enhancements

- [APPS-95] implement app (b250838)
- Implement basic e2e test (d0bf61b)

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>
