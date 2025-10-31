import MyModule from '../../../src/module';

export default defineNuxtConfig({
  modules: [MyModule, '@laioutr-core/frontend-core'],
  '@laioutr/app-klaviyo': {
    companyId: 'VkJHAw',
    defaultNewsletterListId: 'S67q82',
  },
});
