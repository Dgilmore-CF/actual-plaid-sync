export function linkTokenRequest({ clientName, language, countryCodes, userId, redirectUri, webhook, importDays }, accessToken) {
  const request = {
    client_name: clientName,
    language,
    country_codes: countryCodes,
    user: { client_user_id: userId },
    redirect_uri: redirectUri,
  };

  if (accessToken) {
    request.access_token = accessToken;
  } else {
    request.products = ['transactions'];
    request.transactions = { days_requested: importDays };
    request.webhook = webhook;
  }

  return request;
}
