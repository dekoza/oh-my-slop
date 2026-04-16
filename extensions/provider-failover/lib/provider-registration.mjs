import { FAILOVER_API } from './failover-core.mjs';

export const FAILOVER_DUMMY_BASE_URL = 'https://failover.invalid';
export const FAILOVER_DUMMY_API_KEY = 'pi-provider-failover-noop-key';

export function buildFailoverProviderConfig(models, streamSimple) {
  return {
    baseUrl: FAILOVER_DUMMY_BASE_URL,
    apiKey: FAILOVER_DUMMY_API_KEY,
    api: FAILOVER_API,
    models,
    streamSimple,
  };
}
