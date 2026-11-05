import { defineNuxtPlugin, useRuntimeConfig } from 'nuxt/app';
import { startKlaviyoTracking } from '../klaviyoDestination';

export default defineNuxtPlugin({
  name: 'klaviyo:tracking',
  setup() {
    startKlaviyoTracking(useRuntimeConfig().public['@laioutr/app-klaviyo']);
  },
});
