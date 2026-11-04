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
