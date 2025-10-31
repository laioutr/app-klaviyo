import { CreateClientSubscriptionPayload, ErrorResponse } from './types';

class KlaviyoSDK {
  private baseURL: string;
  private companyId: string;

  constructor({ baseURL, companyId }: { baseURL: string; companyId: string }) {
    this.baseURL = baseURL;
    this.companyId = companyId;
  }

  private async call<T = null>(endpoint: string, payload: unknown) {
    const response = await fetch(`${this.baseURL}/${endpoint}?company_id=${this.companyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', revision: '2025-07-15' },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    if (!body) {
      return null;
    }

    const data = JSON.parse(body) as T;

    // Throw any server errors as aggregate errors
    if ((data as ErrorResponse).errors?.length) {
      const errors =
        (data as ErrorResponse).errors?.map((error) => {
          const { title, detail, ...data } = error;
          const cause = new Error(`${title} - ${detail}`);
          (cause as any).data = data;
          return cause;
        }) ?? [];
      throw new AggregateError(errors, `[Klaviyo SDK] Failed to call ${endpoint}`);
    }

    // Throw other errors when the response is not ok
    if (!response.ok) {
      throw new Error(`[Klaviyo SDK] Failed to call ${endpoint}: ${response.statusText} - ${body}`);
    }

    return data;
  }

  /* Endpoints implementation 🚀 */

  async createClientSubscription({ listId, source, profile }: CreateClientSubscriptionPayload) {
    const location =
      profile.location ?
        {
          address1: profile.location.address1,
          address2: profile.location.address2,
          city: profile.location.city,
          country: profile.location.country,
          latitude: profile.location.latitude,
          longitude: profile.location.longitude,
          region: profile.location.region,
          zip: profile.location.zip,
        }
      : undefined;

    const res = await this.call<ErrorResponse | null>('/client/subscriptions', {
      data: {
        type: 'subscription',
        attributes: {
          custom_source: source,
          profile: {
            data: {
              type: 'profile',
              attributes: {
                email: profile.email,
                phone_number: profile.phone,
                first_name: profile.firstName,
                last_name: profile.lastName,
                title: profile.title,
                location,
              },
            },
          },
        },
        relationships: {
          list: {
            data: {
              type: 'list',
              id: listId,
            },
          },
        },
      },
    });

    return res;
  }
}

export default KlaviyoSDK;
