import { SubscribeAction } from '@laioutr-core/canonical-types/newsletter';
import { defineKlaviyoAction } from '../../client/middleware';

export default defineKlaviyoAction(SubscribeAction, async ({ input, context }) => {
  const { listId, email, source, phone, person, address, customFields } = input;

  const { klaviyoClient, defaultNewsletterListId } = context;

  await klaviyoClient.createClientSubscription({
    listId: listId ?? defaultNewsletterListId,
    source,
    profile: {
      email,
      phone,
      firstName: person?.firstName,
      lastName: person?.lastName,
      title: person?.title,
      location:
        address ?
          {
            address1: address?.address1,
            address2: address?.address2,
            city: address?.city,
            country: address?.countryCode,
            region: address?.provinceCode,
            zip: address?.postalCode,
            latitude: address?.latitude,
            longitude: address?.longitude,
          }
        : undefined,
      properties: customFields,
    },
  });

  return {
    status: 'success' as const,
  };
});
