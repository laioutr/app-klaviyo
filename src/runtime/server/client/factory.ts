import KlaviyoSDK from './sdk';
import { useRuntimeConfig } from '#imports';

export default function klaviyoClientFactory() {
  const { baseURL, companyId } = useRuntimeConfig()['@laioutr/app-klaviyo'];

  return new KlaviyoSDK({ baseURL, companyId });
}
