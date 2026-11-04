# Changelog

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
