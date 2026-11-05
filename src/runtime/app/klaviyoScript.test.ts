import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKlaviyoCookies, ensureKlaviyo, getKlaviyo, isKlaviyoLoaded, klaviyoCookieDomains } from './klaviyoScript';

const SCRIPTS = 'script[src*="static.klaviyo.com/onsite/js/"]';
const scripts = () => [...document.querySelectorAll<HTMLScriptElement>(SCRIPTS)];

const removeKlaviyo = () => {
  for (const script of scripts()) {
    script.remove();
  }
  delete (window as any).klaviyo;
  delete (window as any)._klOnsite;
};

beforeEach(removeKlaviyo);
afterEach(removeKlaviyo);

describe('ensureKlaviyo', () => {
  it('inserts the async script with the company id', () => {
    expect(isKlaviyoLoaded()).toBe(false);
    ensureKlaviyo('AbC123');
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.src).toBe('https://static.klaviyo.com/onsite/js/AbC123/klaviyo.js');
    expect(scripts()[0]!.async).toBe(true);
    expect(isKlaviyoLoaded()).toBe(true);
  });

  it('encodes the company id', () => {
    ensureKlaviyo('a/b');
    expect(scripts()[0]!.src).toBe('https://static.klaviyo.com/onsite/js/a%2Fb/klaviyo.js');
  });

  it('inserts once however often it runs', () => {
    ensureKlaviyo('AbC123');
    ensureKlaviyo('AbC123');
    expect(scripts()).toHaveLength(1);
  });

  it('leaves a script that is already on the page alone', () => {
    const existing = document.createElement('script');
    existing.src = 'https://static.klaviyo.com/onsite/js/Other1/klaviyo.js';
    document.head.append(existing);
    ensureKlaviyo('AbC123');
    expect(scripts()).toEqual([existing]);
  });

  it('leaves an existing klaviyo object alone', () => {
    const client = { track: vi.fn() };
    (window as any).klaviyo = client;
    ensureKlaviyo('AbC123');
    expect(window.klaviyo).toBe(client);
  });

  it('queues calls until the script runs them, on a promise that stays pending', async () => {
    ensureKlaviyo('AbC123');
    const result = getKlaviyo().track('Viewed Product', { ProductID: '123' });
    expect((window as any)._klOnsite[0].slice(0, 3)).toEqual(['track', 'Viewed Product', { ProductID: '123' }]);
    expect(await Promise.race([result, Promise.resolve('pending')])).toBe('pending');
  });
});

describe('getKlaviyo', () => {
  it('reads the current object on every call', () => {
    ensureKlaviyo('AbC123');
    const loaded = { track: vi.fn() };
    (window as any).klaviyo = loaded;
    expect(getKlaviyo()).toBe(loaded);
  });
});

describe('klaviyoCookieDomains', () => {
  it.each([
    ['shop.example.com', ['shop.example.com', 'example.com']],
    ['example.com', ['example.com']],
    ['localhost', []],
  ])('for %s gives every parent, never the bare TLD', (hostname, domains) => {
    expect(klaviyoCookieDomains(hostname)).toEqual(domains);
  });
});

describe('clearKlaviyoCookies', () => {
  it('removes a host-only __kla_id and leaves other cookies alone', () => {
    document.cookie = '__kla_id=abc; path=/';
    document.cookie = 'other=1; path=/';
    clearKlaviyoCookies();
    expect(document.cookie).not.toContain('__kla_id=abc');
    expect(document.cookie).toContain('other=1');
    document.cookie = 'other=; Max-Age=0; path=/';
  });

  it('expires the cookie on every domain it could sit on', () => {
    const write = vi.spyOn(document, 'cookie', 'set');
    vi.spyOn(window.location, 'hostname', 'get').mockReturnValue('shop.example.com');
    clearKlaviyoCookies();
    expect(write.mock.calls.map(([value]) => value)).toEqual([
      '__kla_id=; Max-Age=0; path=/',
      '__kla_id=; Max-Age=0; path=/; domain=shop.example.com',
      '__kla_id=; Max-Age=0; path=/; domain=example.com',
    ]);
    vi.restoreAllMocks();
  });
});
