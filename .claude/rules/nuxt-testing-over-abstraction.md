---
paths:
  - "src/runtime/**"
---

# Don't invent a seam to avoid a Nuxt context

Applies to `src/runtime/app/**` and `src/runtime/server/**`. This repo is an app package, so the
"App packages" entry under "How to get the context" is the one that applies here.

Copied from `.claude/rules/nuxt-testing-over-abstraction.md` in the laioutr monorepo, whose rules do
not load in a session rooted in this repo. Paths below that name other packages, `apps/` or
`docs/reviews/` are in the monorepo: worked classifications are in its
`docs/reviews/2026-08-17-testability-abstractions-audit.md` (analytics and consent) and
`docs/reviews/2026-08-31-orchestr-cache-seam-review.md` (orchestr cache).

`@nuxt/test-utils` is already configured in these packages. A composable, store, plugin or
`nuxtApp` is available to any test that asks for one, so "the test needs it without Nuxt" is not a
reason for a parameter, a `Deps` object, or a narrowed structural interface.

## The shape: no `Deps` objects here

`apps/registry` and `apps/cdn-api` inject a `Deps` object, and
`.claude/rules/hono-workers-service.md` requires it — a Workers handler has no other way to reach
`c.env`. **That constraint is local to those services and the pattern does not travel.** Client
runtime code reaches its collaborators by calling them.

Two shapes to write instead of, not alongside:

```ts
// ✘ an interface whose members wrap composables, globals, and the clock
export interface VisitorTokenDeps {
  getCookie: (key: string) => string | undefined;
  setCookie: (key: string, value: string, maxAgeSeconds: number) => void;
  uuid: () => string;
  now: () => number;
  hasAnalyticsConsent: () => boolean;
}
export const createVisitorTokenManager = (deps: VisitorTokenDeps) => { … };

// ✅ the values the caller genuinely owns, as plain parameters; everything else called directly
export const createVisitorTokenManager = (cookieOptions: ResolvedCookieOptions) => {
  const consent = useConsentStore();
  const token = crypto.randomUUID();
  …
};
```

```ts
// ✘ curried: the call site becomes a factory feeding a factory
createEntityProjector(nuxt, createEntityAddress({ resolveOrThrow, canResolve }));

// ✅ one function, named for what it returns
createEntityProjector(nuxt, entityAddressOf);
```

The test for a value the caller owns passes that value. The test for a collaborator module uses
`vi.mock('<path relative to the test file>')`. The test for a clock or an id source uses
`vi.useFakeTimers()` and `vi.spyOn(crypto, 'randomUUID')` — neither needs a parameter.

**A bound the seam made observable is not a reason to keep it.** Extract the computation and test
it directly: `sessionCookieMaxAgeSeconds(createdAt, now)` is a pure function, so the 24-hour clip
survives deleting every injected accessor.

## The rule

**Reach for the real thing first.** Use `useNuxtApp()`, `useConsentStore()`, `nuxt.hook(...)`,
`useCookie()` in the test. Add a seam only when you can name what the real collaborator cannot do.

```ts
// ✘ a fake that reimplements the mechanism under test
const fakeNuxt = (handlers) => ({
  hooks: { callHookWith: (caller, _hook, payload) => caller(handlers, [payload]) },
});

// ✅ the real app, the real hook, the real calling convention
const nuxt = useNuxtApp();
const unhook = nuxt.hook('frontend-core:analytics:project', handler);
```

The fake above ignored the hook *name*, so renaming the hook in production left it green. Any fake
that restates how a framework mechanism works can drift from it silently — that is the whole class.

**A comment naming tests as the motive is the tell.** `// so it stays testable without Nuxt` next
to an interface means the interface is answering a question that has an answer.

**A second tell: one clock injected, another called directly.** A store routing `Date.now()` through
a `now` option while calling `performance.now()` three lines away injected the clock its tests
wanted, not one the code needs. An injected clock is also *frozen*, so it cannot express "the same
instance, an hour later" — the seam removes a test case rather than adding one.

**A narrowed structural interface is wider than the type it replaced.** `{ context: Record<string,
unknown> }` standing in for `H3Event` accepts anything with a `context`: TypeScript gives mapped
types an implicit index signature, so `OrchestrArgsBase` satisfies it and the wrong argument
compiles. Take the real type.

**The rationalization to expect** — written by an agent that had not read this rule, asked for a
cookie-backed module plus "fast, deterministic" unit tests:

> The real `useCookie` is a Nuxt auto-import that only exists inside a Nuxt app context. Stub it
> with an in-memory ref-like store so the module under test can run under plain vitest, fast and
> without booting Nuxt.

Each clause is false here. The context exists in every one of these packages; nothing needs booting
because the `nuxt` project already runs these files inside it; and the stub is aimed at `#imports`,
a specifier the unimport transform has already rewritten, so it silently does nothing (below). Four
of five agents wrote some version of this before being shown this rule; none did after.

## How to get the context

- **`frontend-core`** — nothing to do. `vitest.workspace.ts` puts every
  `src/runtime/app/**/*.test.ts` in the `nuxt` project already. A `// @vitest-environment nuxt`
  comment there is redundant.
- **App packages** — `vitest.config.ts` needs `environmentOptions.nuxt.rootDir` pointed at the
  package's `playground`, or the Nuxt environment boots without frontend-core's module and its
  auto-imports are absent:

  ```ts
  export default defineVitestConfig({
    test: {
      include: ['src/**/*.test.ts'],
      environmentOptions: { nuxt: { rootDir: './playground' } },
    },
  });
  ```

  `app-gtm` has this; `app-cookiebot` and `app-ccm19` do not. Without it, importing a
  frontend-core composable fails to collect with
  `[unimport] failed to find "useConsentStore" imported from "#imports"` — which does not name the
  cause. Check `rootDir` before debugging that message.
- **Server runtime (`src/runtime/server/**`)** — the same `nuxt` environment collects these, so the
  rule holds unchanged for the clock, `console`, and ordinary collaborator modules. **One class is
  genuinely out of reach: Nitro server auto-imports.** `useStorage`'s production implementation is a
  build-time virtual module absent from the Vite context, so a file naming it at module scope fails
  to *transform*, not merely to run. orchestr's `vitest.config.ts` answers that with
  `environmentOptions.nuxt.overrides.imports` — `useStorage` to a real in-memory `unstorage` stub,
  `useEvent` to its nitropack implementation. Add an entry there rather than a parameter. The
  exemption covers those imports and nothing else.
- **Driving the consent store** — install an adapter with `setAdapter` and push state through the
  `report` function its `setup` receives, so the store's watcher stays in the path, then
  `await nextTick()`. Hold the returned stop handle and call it in `afterEach`.

## When a seam is still right

Not "is it DI" — DI that earns its keep looks identical. Ask **what the seam lets the test reach
that the real collaborator cannot**:

- **Network or a server that isn't there.** `createTransportDestination({ send })`. Budget for the
  cost: everything the default implementation does — `sendBeacon`, the `fetch` fallback, the
  non-`ok` throw — is then untested, and needs its own test.
- **Two instances of a per-app singleton.** One test process has one `nuxtApp`; proving that two
  concurrent SSR requests do not share state needs two (`useAppState.test.ts` mocks `#app`).
- **A bound whose production value makes the test absurd.** Evicting at the real 50-event /
  256 KB replay bound.
- **A second real implementation exists.** `ConsentAdapter` has Cookiebot, CCM19, and third
  parties. That is an interface, not a seam.
- **A library that captured a global at import time.** `lru-cache` binds `performance` when it
  loads, and vitest's fake timers install a *new* global object, so they never reach it — its own
  `perf` option is the only way in. Measure before you accept this one: it is also the shape a
  rationalization takes.
- **A genuine layer boundary.** `createAnalyticsBus` is a delivery state machine over a consent
  oracle and imports nothing from Nuxt; `analyticsBus.ts` is the 27 lines that wire the real store
  and hooks into it. The split survives deleting every test.

One real implementation is **not** on its own a verdict. Most seams above have exactly one.

Two entries that used to sit in this list were removed after the code was rewritten without them —
a clock and an id source (`VisitorTokenDeps.now` / `.uuid`), and a collaborator that had to throw a
`TypeError` (`EntityAddressDeps.resolveOrThrow`). Fake timers, a `crypto.randomUUID` spy and
`vi.mock` of the collaborator module cover all three, so neither reached anything a test could not
reach without it. **Check a candidate against those three tools before concluding a seam is
needed.**

## What a synchronous fake hides

The visitor-token fake stored cookies in a `Map`, so writes landed immediately. Real `useCookie`
writes through a `flush: 'pre'` watcher, so `document.cookie` lags a tick — and production had
always gone through `useCookie`. A test named *"deletes synchronously on revoke"* therefore
asserted a property the shipped code never had, and would have kept passing if deletion had been
deferred much further.

Any fake that is more immediate, more ordered, or more total than the real collaborator moves the
test off the behaviour it names. That is the same class as the hook fake above, and it is the
reason "the fake is simpler" is an argument against it.

## The `vi.mock('#imports')` trap

**Under the `nuxt` environment, `vi.mock('#imports', …)` is silently ignored.** Nuxt's unimport
transform rewrites `#imports` specifiers to direct module imports before vitest sees them, so the
factory is registered against a module nothing imports. No error, no warning — the test runs the
real composable while reading as though it were mocked, and any assertion that would have caught a
regression now can't.

```ts
// ✘ in the `nuxt` project: the real useRuntimeConfig runs
vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: { flag: true } }) }));
```

Two things that do work, and are easy to confuse with it:

- **`vi.mock('#app', …)`** intercepts — `#app` resolves to a real module.
- **`vi.mock('#imports', …)` in frontend-core's `app-unit` / `integration` projects** intercepts,
  because those projects alias `#imports` to `test/stubs/imports.ts`. That is what the
  `appUnitTests` list in `vitest.workspace.ts` is for; a test relying on the mock must be in it.

If you find `vi.mock('#imports')` in a file the `nuxt` project collects, the test is not testing
what it says. Delete the mock and use the real composable, or move the file to `app-unit`.

## Removing a seam

Converting a test to a Nuxt context and finding it still green proves nothing on its own — a test
that no longer gates anything is worse than the seam you removed. Sabotage the behaviour it covers
and confirm it fails, then restore.
