import type { RuntimeConfigModulePrivate, RuntimeConfigModulePublic } from './module';

declare module 'vue' {
  interface GlobalComponents {}
  interface ComponentCustomProperties {
    // Add your module's custom properties here
  }
}

declare module '@nuxt/schema' {
  interface PublicRuntimeConfig {
    ['@laioutr/app-klaviyo']: RuntimeConfigModulePublic;
  }
  interface RuntimeConfig {
    ['@laioutr/app-klaviyo']: RuntimeConfigModulePrivate;
  }
}

export {};
