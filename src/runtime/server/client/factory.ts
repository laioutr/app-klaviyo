import KlaviyoSDK from './sdk';
import { useRuntimeConfig } from '#imports';

/** Create a klaviyo client using the runtime-config of this module. */
export default function klaviyoClientFactory() {
  const { baseURL, companyId } = useRuntimeConfig()['@laioutr/app-klaviyo'];

  return new KlaviyoSDK({ baseURL, companyId });
}
