# Klaviyo (Laioutr App)

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]
[![Nuxt][nuxt-src]][nuxt-href]

Integrate Klaviyo into your [Laioutr](https://laioutr.com) project.

See [laioutr.com](https://laioutr.com) for more information about Laioutr.

- [✨ &nbsp;Release Notes](/CHANGELOG.md)
  <!-- - [🏀 Online playground](https://stackblitz.com/github/your-org/@laioutr/app-klaviyo?file=playground%2Fapp.vue) -->
  <!-- - [📖 &nbsp;Documentation](https://example.com) -->

## Features

Implements the following canonical actions:

- [`newsletter/subscribe`](https://docs.laioutr.io/canonical-types/newsletter/canonical-actions) Newsletter registration action

It also loads Klaviyo's script on the storefront for visitors who accept marketing cookies. That enables Klaviyo forms, identifies logged-in customers and newsletter sign-ups, and sends these canonical events to Klaviyo:

- `ecommerce/view_item` as Viewed Product
- `ecommerce/add_to_cart` as Added to Cart, with the whole cart
- `ecommerce/begin_checkout` as Started Checkout, when `sendStartedCheckout` is on

## Quick Setup

Before installing dependencies, you need to create a copy of the `.npmrc.config` file called `.npmrc` and fill in the `NPM_LAIOUTR_TOKEN` with your npm token. You can find this token in your [project settings](https://cockpit.laioutr.cloud/o/_/p/_/settings).

- `pnpm i`
- `npx @laioutr/cli project fetch-rc -p <organization slug>/<project slug> -s <project secret key>` - This will load the `laioutrrc.json` file with the current remote project configuration.
- `pnpm dev:prepare`
- `pnpm orchestr-dev`

That's it! You can now use Klaviyo in your [Laioutr Frontend](https://laioutr.com) ✨

You can find a thorough guide on getting started with Laioutr development in our [developer guide](https://docs.laioutr.io/developer-guide/setup).

## Storefront tracking

Tracking is on by default. Turn it off with the `onsiteTracking` setting in the Cockpit. Klaviyo's own integrations send orders, so this app needs no private API key.

### All shops

- A consent app is required. Consent defaults to denied, so without one Klaviyo never loads.
- List Klaviyo as a marketing cookie in the cookie banner. The app requires the `advertising` consent purpose, and forms follow the same rule as tracking.

### Shopify

- Keep Klaviyo's Shopify integration connected. It sends Placed Order and Checkout Started, so leave `sendStartedCheckout` off.
- Check that nothing else loads `klaviyo.js`. Klaviyo warns that a second copy can break tracking.
- Ask Klaviyo support to point catalog URLs at the storefront domain instead of `myshopify.com`.

### Shopware

- Install Klaviyo's Shopware extension with order metrics on and onsite metrics off, and connect one sales channel.
- Turn on `sendStartedCheckout`.

Two limits apply on Shopware:

- A first-time guest who abandons in the checkout frame gets no email, because this app cannot see the address they type there. Logged-in customers and visitors Klaviyo already knows are unaffected.
- The cart's checkout link points at the checkout page, so an email link may not restore the cart, for example on another device.

## Publishing

Add a changeset to your change with `pnpm changeset`. Once it reaches `main`, the release workflow opens a `chore: release` pull request. Merging that pull request will:

- Publish the package to npmjs.org
- Send the version and its `laioutr.manifest.json` to the Cockpit with `laioutr app release`, which gives the Cockpit the settings form

The workflow needs the repository secret `LAIOUTR_APP_PUBLISH_KEY`, a key with the `app:publish` scope. If the last step fails, the version is already published and re-running the workflow will not send it again. Fix the problem, then run `LAIOUTR_APP_PUBLISH_KEY=<key> pnpm release:cockpit` on the released commit.

## Contribution

Follow the [setup guide](https://docs.laioutr.io/developer-guide/setup) to get started.

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/@laioutr/app-klaviyo/latest.svg?style=flat&colorA=020420&colorB=00DC82
[npm-version-href]: https://npmjs.com/package/@laioutr/app-klaviyo
[npm-downloads-src]: https://img.shields.io/npm/dm/@laioutr/app-klaviyo.svg?style=flat&colorA=020420&colorB=00DC82
[npm-downloads-href]: https://npm.chart.dev/@laioutr/app-klaviyo
[license-src]: https://img.shields.io/npm/l/@laioutr/app-klaviyo.svg?style=flat&colorA=020420&colorB=00DC82
[license-href]: https://npmjs.com/package/@laioutr/app-klaviyo
[nuxt-src]: https://img.shields.io/badge/Nuxt-020420?logo=nuxt.js
[nuxt-href]: https://nuxt.com
