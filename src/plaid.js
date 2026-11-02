import { Configuration, PlaidApi, PlaidEnvironments, Products } from 'plaid';
import { config } from './config.js';
const configuration = new Configuration({ basePath: config.plaidEnv === 'production' ? PlaidEnvironments.production : PlaidEnvironments.sandbox, baseOptions: { headers: { 'PLAID-CLIENT-ID': config.plaidClientId, 'PLAID-SECRET': config.plaidSecret } } });
export const plaid = new PlaidApi(configuration);
export async function createLinkToken(accessToken) { const request = { client_name: 'Actual Plaid Sync', language: 'en', country_codes: config.countries, user: { client_user_id: config.userId }, redirect_uri: `${config.appUrl}/oauth-return`, webhook: `${config.appUrl}/webhooks/plaid` }; if (accessToken) request.access_token = accessToken; else { request.products = [Products.Transactions]; request.transactions = { days_requested: config.importDays }; } return (await plaid.linkTokenCreate(request)).data.link_token; }
