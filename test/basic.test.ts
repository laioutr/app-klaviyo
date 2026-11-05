// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { $fetch, setup } from '@nuxt/test-utils/e2e';
import { describe, expect, it } from 'vitest';

describe('api', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('./fixtures/basic', import.meta.url)),
  });

  it('subscribes to the newsletter', async () => {
    // Get response to a server-rendered page with `$fetch`.
    const response = await $fetch('/api/orchestr/action/newsletter/subscribe', {
      responseType: 'json',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        input: {
          email: 'test@test.com',
        },
        clientEnv: {
          locale: 'de-DE',
          currency: 'EUR',
          isPreview: false,
          custom: {},
        },
      },
    });
    expect(response.output.status).toBe('success');
  });
});
