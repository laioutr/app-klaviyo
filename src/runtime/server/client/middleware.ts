import klaviyoClientFactory from './factory';
import { defineOrchestr, useRuntimeConfig } from '#imports';
import { name } from '../../../../package.json';

export const defineKlaviyo = defineOrchestr
  .meta({
    app: name,
  })
  .extendRequest(() => {
    const { defaultNewsletterListId } = useRuntimeConfig()['@laioutr/app-klaviyo'];
    const klaviyoClient = klaviyoClientFactory();

    return { context: { klaviyoClient, defaultNewsletterListId } };
  });

export const defineKlaviyoAction = defineKlaviyo.actionHandler;
