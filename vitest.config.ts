import { defineVitestConfig } from '@nuxt/test-utils/config';

export default defineVitestConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environmentOptions: {
      nuxt: {
        rootDir: './playground',
      },
      // Happy DOM would otherwise download and run every script a test inserts, and Klaviyo's sends data.
      happyDom: {
        settings: {
          disableJavaScriptFileLoading: true,
        },
      },
    },
  },
});
