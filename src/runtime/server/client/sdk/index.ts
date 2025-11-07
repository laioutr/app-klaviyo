import { CreateClientSubscriptionPayload, KlavyioResponse } from './types';

const API_REVISION = '2025-07-15';

class KlaviyoSDK {
  private baseURL: string;
  private companyId: string;

  constructor({ baseURL, companyId }: { baseURL: string; companyId: string }) {
    this.baseURL = baseURL;
    this.companyId = companyId;
  }

  /**
   * Call a Klaviyo endpoint. Throws errors, if API contains error-data.
   * @param endpoint path to endpoint that should be called, without leading slash.
   * @param payload json payload data
   * @returns A promise resolving to the data returned by the api
   */
  public async call<T = null>(endpoint: string, payload: unknown) {
    const response = await fetch(`${this.baseURL}/${endpoint}?company_id=${this.companyId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', revision: API_REVISION },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    if (!body) {
      return null;
    }

    const data = JSON.parse(body) as KlavyioResponse<T>;

    // Throw any server errors as aggregate errors
    if (data.errors?.length) {
      const errors =
        data.errors?.map((error) => {
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

    return data.data;
  }

  /**
   * Subscribe to a newsletter list.
   * @param param0 Data required for creating a subscription
   * @returns A promise resolving to klaviyo subscription data
   * @see https://developers.klaviyo.com/en/reference/create_client_subscription
   */
  public async subscribeToNewsletter({ listId, source, profile }: CreateClientSubscriptionPayload) {
    const res = await this.call('/client/subscriptions', {
      data: {
        type: 'subscription',
        attributes: {
          custom_source: source,
          profile: {
            data: {
              type: 'profile',
              attributes: profile,
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
