import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app';
import { defineAnalyticsDestination, fetchAction, linkResolver, useAnalytics, useConsentStore, useOrchestrStore } from '#imports';
import { CustomerGetCurrentAction } from '@laioutr-core/canonical-types/ecommerce';
import { fetchCart } from '../klaviyoCart';
import { startKlaviyoTracking } from '../klaviyoDestination';
import { clearKlaviyoCookies, ensureKlaviyo, getKlaviyo } from '../klaviyoScript';

export default defineNuxtPlugin({
  name: 'klaviyo:tracking',
  setup(nuxtApp) {
    const analytics = useAnalytics();
    const consent = useConsentStore();

    startKlaviyoTracking(useRuntimeConfig().public['@laioutr/app-klaviyo'], {
      load: ensureKlaviyo,
      klaviyo: getKlaviyo,
      clearCookies: clearKlaviyoCookies,
      reload: () => window.location.reload(),
      hasConsent: () => consent.hasPurposeConsent('advertising'),
      fetchCart: () =>
        fetchCart({
          orchestr: nuxtApp.runWithContext(() => useOrchestrStore()) as any,
          origin: window.location.origin,
          resolveLink: (link) => nuxtApp.runWithContext(() => linkResolver.resolveOrThrow(link, { withOrigin: true })) as string,
        }),
      fetchCustomer: () => nuxtApp.runWithContext(() => fetchAction(CustomerGetCurrentAction)) as Promise<any>,
      register: (config) => analytics.register(defineAnalyticsDestination(config)),
      onActionFinished: (handler) => nuxtApp.hook('orchestr:action:fetch:finally' as any, handler),
      warn: (message) => console.warn(message),
    });
  },
});
