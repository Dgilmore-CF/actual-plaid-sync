import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { config } from './config.js';
import { linkTokenRequest } from './link-token-request.js';
const configuration = new Configuration({ basePath: config.plaidEnv === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox, baseOptions: { headers: { 'PLAID-CLIENT-ID': config.plaidClientId, 'PLAID-SECRET': config.plaidSecret } } });
export const plaid = new PlaidApi(configuration);
export async function createLinkToken(accessToken) {
  const request = linkTokenRequest({
    clientName: 'Actual Plaid Sync',
    language: 'en',
    countryCodes: config.countries,
    userId: config.userId,
    redirectUri: `${config.appUrl}/oauth-return`,
    webhook: `${config.appUrl}/webhooks/plaid`,
    importDays: config.importDays,
  }, accessToken);
  return (await plaid.linkTokenCreate(request)).data.link_token;
}
