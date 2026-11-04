---
'@laioutr/app-klaviyo': minor
---

The app no longer installs its own `@laioutr-core/frontend-core`, `@laioutr-core/canonical-types` and `@laioutr-core/kit`, which put a second core next to the project's. They are peer dependencies now: `frontend-core`, `core-types` and `kit` from 0.78.0, `canonical-types` from 0.39.10.
