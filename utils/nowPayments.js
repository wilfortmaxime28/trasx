const crypto = require('crypto');
const { getSetting } = require('./appSettings');

const DEFAULT_API_HOST = 'https://api.nowpayments.io';

function trimOrEmpty(value) {
  return String(value || '').trim();
}

async function readSetting(settingKey, envKey = null, fallback = '') {
  const envValue = envKey ? trimOrEmpty(process.env[envKey]) : '';
  if (envValue) return envValue;
  return trimOrEmpty(await getSetting(settingKey, fallback));
}

async function getConfig() {
  const apiHost = await readSetting('nowpayments_api_host', 'NOWPAYMENTS_API_HOST', DEFAULT_API_HOST);
  const apiKey = await readSetting('nowpayments_api_key', 'NOWPAYMENTS_API_KEY');
  const email = await readSetting('nowpayments_email', 'NOWPAYMENTS_EMAIL');
  const password = await readSetting('nowpayments_password', 'NOWPAYMENTS_PASSWORD');
  const ipnSecret = await readSetting('nowpayments_ipn_secret', 'NOWPAYMENTS_IPN_SECRET');
  const twoFactorSecret = await readSetting('nowpayments_2fa_secret', 'NOWPAYMENTS_2FA_SECRET');
  const callbackBaseUrl = await readSetting('nowpayments_callback_base_url', 'NOWPAYMENTS_CALLBACK_BASE_URL');
  const depositUsdtCurrency = (await readSetting('nowpayments_deposit_currency_usdt', 'NOWPAYMENTS_DEPOSIT_CURRENCY_USDT', 'usdtbsc')).toLowerCase();
  const depositBnbCurrency = (await readSetting('nowpayments_deposit_currency_bnb', 'NOWPAYMENTS_DEPOSIT_CURRENCY_BNB', 'bnbbsc')).toLowerCase();
  const withdrawCurrency = (await readSetting('nowpayments_withdraw_currency', 'NOWPAYMENTS_WITHDRAW_CURRENCY', 'usdtbsc')).toLowerCase();
  const paymentsProvider = (await readSetting('payments_provider', 'TRASX_PAYMENTS_PROVIDER', 'nowpayments')).toLowerCase();

  return {
    apiHost: trimOrEmpty(apiHost || DEFAULT_API_HOST).replace(/\/+$/, ''),
    apiKey,
    email,
    password,
    ipnSecret,
    twoFactorSecret,
    callbackBaseUrl: trimOrEmpty(callbackBaseUrl).replace(/\/+$/, ''),
    depositUsdtCurrency,
    depositBnbCurrency,
    withdrawCurrency,
    paymentsProvider
  };
}

async function ensureConfig(requiredKeys = []) {
  const config = await getConfig();
  const missing = requiredKeys.filter((key) => !trimOrEmpty(config[key]));
  if (missing.length > 0) {
    const error = new Error(`Configuration NOWPayments incomplète: ${missing.join(', ')}`);
    error.code = 'NOWPAYMENTS_CONFIG_MISSING';
    error.missingKeys = missing;
    throw error;
  }
  return config;
}

async function request(pathname, options = {}) {
  const { authToken = null, method = 'GET', body = null, headers = {}, requiredConfigKeys = ['apiKey'] } = options;
  const config = await ensureConfig(requiredConfigKeys);
  const finalHeaders = {
    'x-api-key': config.apiKey,
    ...headers
  };

  if (authToken) {
    finalHeaders.Authorization = `Bearer ${authToken}`;
  }

  const fetchOptions = {
    method,
    headers: finalHeaders
  };

  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
    fetchOptions.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${config.apiHost}${pathname}`, fetchOptions);
  const rawText = await response.text();
  let payload = null;

  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch (_) {
      payload = rawText;
    }
  }

  if (!response.ok) {
    const err = new Error(
      (payload && typeof payload === 'object' && (payload.message || payload.error || payload.code))
        || `NOWPayments request failed (${response.status})`
    );
    err.status = response.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

async function authenticate() {
  const config = await ensureConfig(['apiKey', 'email', 'password']);
  const response = await request('/v1/auth', {
    method: 'POST',
    body: {
      email: config.email,
      password: config.password
    },
    requiredConfigKeys: ['apiKey', 'email', 'password']
  });

  if (!response?.token) {
    throw new Error('NOWPayments auth token introuvable.');
  }

  return response.token;
}

async function createPayment(payload) {
  return request('/v1/payment', {
    method: 'POST',
    body: payload,
    requiredConfigKeys: ['apiKey']
  });
}

async function getPaymentStatus(paymentId) {
  return request(`/v1/payment/${encodeURIComponent(String(paymentId))}`, {
    method: 'GET',
    requiredConfigKeys: ['apiKey']
  });
}

async function getMinimumAmount({ currencyFrom = 'usd', currencyTo, isFeePaidByUser = true } = {}) {
  const from = trimOrEmpty(currencyFrom).toLowerCase();
  const to = trimOrEmpty(currencyTo).toLowerCase();

  if (!from || !to) {
    throw new Error('NOWPayments minimum amount requires both currencyFrom and currencyTo.');
  }

  const params = new URLSearchParams({
    currency_from: from,
    currency_to: to,
    is_fee_paid_by_user: String(Boolean(isFeePaidByUser))
  });

  return request(`/v1/min-amount?${params.toString()}`, {
    method: 'GET',
    requiredConfigKeys: ['apiKey']
  });
}

async function validateAddress(payload, authToken) {
  return request('/v1/payout/validate-address', {
    method: 'POST',
    body: payload,
    authToken,
    requiredConfigKeys: ['apiKey']
  });
}

async function createPayout(payload, authToken) {
  return request('/v1/payout', {
    method: 'POST',
    body: payload,
    authToken,
    requiredConfigKeys: ['apiKey', 'email', 'password']
  });
}

async function verifyPayout(batchId, verificationCode, authToken) {
  return request(`/v1/payout/${encodeURIComponent(String(batchId))}/verify`, {
    method: 'POST',
    body: {
      verification_code: String(verificationCode || '').trim()
    },
    authToken,
    requiredConfigKeys: ['apiKey', 'email', 'password']
  });
}

async function getPayoutStatus(payoutId) {
  return request(`/v1/payout/${encodeURIComponent(String(payoutId))}`, {
    method: 'GET',
    requiredConfigKeys: ['apiKey']
  });
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortObject(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortObject(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function verifyIpnSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;

  let parsed;
  try {
    parsed = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch (_) {
    return false;
  }

  const sortedPayload = JSON.stringify(sortObject(parsed));
  const digest = crypto
    .createHmac('sha512', String(secret).trim())
    .update(sortedPayload)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(signature).trim()));
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(secret || '').replace(/=+$/g, '').replace(/[\s-]+/g, '').toUpperCase();
  let bits = '';

  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value === -1) {
      throw new Error('Clé 2FA NOWPayments invalide (base32).');
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret, timestampMs = Date.now()) {
  const key = base32Decode(secret);
  const counter = Math.floor(timestampMs / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff)
  );

  return String(binary % 1000000).padStart(6, '0');
}

function getIpnUrl(callbackBaseUrl) {
  const trimmed = trimOrEmpty(callbackBaseUrl).replace(/\/+$/, '');
  return trimmed ? `${trimmed}/api/nowpayments/ipn` : '';
}

module.exports = {
  authenticate,
  createPayment,
  createPayout,
  ensureConfig,
  generateTotp,
  getConfig,
  getIpnUrl,
  getMinimumAmount,
  getPaymentStatus,
  getPayoutStatus,
  request,
  validateAddress,
  verifyIpnSignature,
  verifyPayout
};
