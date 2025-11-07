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

## Quick Setup

Before installing dependencies, you need to create a copy of the `.npmrc.config` file called `.npmrc` and fill in the `NPM_LAIOUTR_TOKEN` with your npm token. You can find this token in your [project settings](https://cockpit.laioutr.cloud/o/_/p/_/settings).

- `pnpm i`
- `npx @laioutr/cli project fetch-rc -p <organization slug>/<project slug> -s <project secret key>` - This will load the `laioutrrc.json` file with the current remote project configuration.
- `pnpm dev:prepare`
- `pnpm orchestr-dev`

That's it! You can now use Klaviyo in your [Laioutr Frontend](https://laioutr.com) ✨

You can find a thorough guide on getting started with Laioutr development in our [developer guide](https://docs.laioutr.io/developer-guide/setup).

## Publishing

To publish a new version, run `pnpm release`. This will:

- Run the tests
- Update the changelog
- Publish the package to npmjs.org
- Push the changes to the repository

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
