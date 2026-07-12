const COUNTRY_CURRENCY_MAP = {
  HT: 'HTG',
  HAITI: 'HTG',
  AYITI: 'HTG',
  US: 'USD',
  USA: 'USD',
  'UNITED STATES': 'USD',
  CA: 'CAD',
  CANADA: 'CAD',
  MX: 'MXN',
  MEXICO: 'MXN',
  DO: 'DOP',
  'DOMINICAN REPUBLIC': 'DOP',
  JM: 'JMD',
  JAMAICA: 'JMD',
  CU: 'CUP',
  CUBA: 'CUP',
  BS: 'BSD',
  BAHAMAS: 'BSD',
  BR: 'BRL',
  BRAZIL: 'BRL',
  BRASIL: 'BRL',
  FR: 'EUR',
  FRANCE: 'EUR',
  DE: 'EUR',
  GERMANY: 'EUR',
  ES: 'EUR',
  SPAIN: 'EUR',
  IT: 'EUR',
  ITALY: 'EUR',
  BE: 'EUR',
  BELGIUM: 'EUR',
  PT: 'EUR',
  PORTUGAL: 'EUR',
  NL: 'EUR',
  NETHERLANDS: 'EUR',
  IE: 'EUR',
  IRELAND: 'EUR',
  LU: 'EUR',
  LUXEMBOURG: 'EUR',
  GR: 'EUR',
  GREECE: 'EUR',
  FI: 'EUR',
  FINLAND: 'EUR',
  AT: 'EUR',
  AUSTRIA: 'EUR',
  AR: 'ARS',
  ARGENTINA: 'ARS',
  CL: 'CLP',
  CHILE: 'CLP',
  CO: 'COP',
  COLOMBIA: 'COP',
  PE: 'PEN',
  PERU: 'PEN',
  VE: 'VES',
  VENEZUELA: 'VES',
  UY: 'UYU',
  URUGUAY: 'UYU',
  PY: 'PYG',
  PARAGUAY: 'PYG',
  BO: 'BOB',
  BOLIVIA: 'BOB',
  EC: 'USD',
  ECUADOR: 'USD',
  PA: 'USD',
  PANAMA: 'USD',
  CR: 'CRC',
  'COSTA RICA': 'CRC',
  GT: 'GTQ',
  GUATEMALA: 'GTQ',
  HN: 'HNL',
  HONDURAS: 'HNL',
  NI: 'NIO',
  NICARAGUA: 'NIO',
  SV: 'USD',
  'EL SALVADOR': 'USD',
  GB: 'GBP',
  UK: 'GBP',
  'UNITED KINGDOM': 'GBP',
  CH: 'CHF',
  SWITZERLAND: 'CHF',
  NO: 'NOK',
  NORWAY: 'NOK',
  SE: 'SEK',
  SWEDEN: 'SEK',
  DK: 'DKK',
  DENMARK: 'DKK',
  PL: 'PLN',
  POLAND: 'PLN',
  CZ: 'CZK',
  'CZECH REPUBLIC': 'CZK',
  HU: 'HUF',
  HUNGARY: 'HUF',
  RO: 'RON',
  ROMANIA: 'RON',
  BG: 'BGN',
  BULGARIA: 'BGN',
  TR: 'TRY',
  TURKEY: 'TRY',
  RU: 'RUB',
  RUSSIA: 'RUB',
  UA: 'UAH',
  UKRAINE: 'UAH',
  MA: 'MAD',
  MOROCCO: 'MAD',
  DZ: 'DZD',
  ALGERIA: 'DZD',
  TN: 'TND',
  TUNISIA: 'TND',
  EG: 'EGP',
  EGYPT: 'EGP',
  NG: 'NGN',
  NIGERIA: 'NGN',
  GH: 'GHS',
  GHANA: 'GHS',
  KE: 'KES',
  KENYA: 'KES',
  ZA: 'ZAR',
  'SOUTH AFRICA': 'ZAR',
  ET: 'ETB',
  ETHIOPIA: 'ETB',
  IN: 'INR',
  INDIA: 'INR',
  PK: 'PKR',
  PAKISTAN: 'PKR',
  BD: 'BDT',
  BANGLADESH: 'BDT',
  CN: 'CNY',
  CHINA: 'CNY',
  JP: 'JPY',
  JAPAN: 'JPY',
  KR: 'KRW',
  'SOUTH KOREA': 'KRW',
  HK: 'HKD',
  'HONG KONG': 'HKD',
  SG: 'SGD',
  SINGAPORE: 'SGD',
  MY: 'MYR',
  MALAYSIA: 'MYR',
  TH: 'THB',
  THAILAND: 'THB',
  VN: 'VND',
  VIETNAM: 'VND',
  PH: 'PHP',
  PHILIPPINES: 'PHP',
  ID: 'IDR',
  INDONESIA: 'IDR',
  AE: 'AED',
  'UNITED ARAB EMIRATES': 'AED',
  SA: 'SAR',
  'SAUDI ARABIA': 'SAR',
  QA: 'QAR',
  QATAR: 'QAR',
  AU: 'AUD',
  AUSTRALIA: 'AUD',
  NZ: 'NZD',
  'NEW ZEALAND': 'NZD'
};

const COUNTRY_PAYMENT_METHODS_MAP = {
  HT: ['MonCash', 'NatCash', 'Banque locale'],
  HAITI: ['MonCash', 'NatCash', 'Banque locale'],
  AYITI: ['MonCash', 'NatCash', 'Banque locale'],
  US: ['Cash App', 'Zelle', 'Bank transfer'],
  USA: ['Cash App', 'Zelle', 'Bank transfer'],
  'UNITED STATES': ['Cash App', 'Zelle', 'Bank transfer'],
  CA: ['Interac e-Transfer', 'Bank transfer'],
  CANADA: ['Interac e-Transfer', 'Bank transfer'],
  FR: ['Virement bancaire', 'Paylib'],
  FRANCE: ['Virement bancaire', 'Paylib'],
  DO: ['Banreservas', 'Banco Popular', 'Transferencia'],
  'DOMINICAN REPUBLIC': ['Banreservas', 'Banco Popular', 'Transferencia'],
  BR: ['PIX', 'Transferencia bancaria'],
  BRAZIL: ['PIX', 'Transferencia bancaria'],
  BRASIL: ['PIX', 'Transferencia bancaria'],
  MX: ['SPEI', 'Transferencia bancaria'],
  MEXICO: ['SPEI', 'Transferencia bancaria'],
  JM: ['Bank transfer', 'Remittance pickup'],
  JAMAICA: ['Bank transfer', 'Remittance pickup'],
  GB: ['Bank transfer', 'Revolut'],
  UK: ['Bank transfer', 'Revolut'],
  'UNITED KINGDOM': ['Bank transfer', 'Revolut'],
  EU: ['SEPA', 'Virement bancaire'],
  DEFAULT: ['Bank transfer']
};

let cachedCurrencyOptions = null;

function buildCurrencyOptions() {
  if (cachedCurrencyOptions) return cachedCurrencyOptions;

  const displayNames = typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'currency' })
    : null;
  const supportedCodes = typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('currency')
    : ['USD', 'EUR', 'HTG', 'CAD', 'GBP'];

  cachedCurrencyOptions = supportedCodes
    .map((code) => ({
      code,
      name: displayNames ? displayNames.of(code) : code,
      label: `${code} - ${displayNames ? displayNames.of(code) : code}`
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  return cachedCurrencyOptions;
}

function getPreferredCurrencyForCountry(country) {
  const raw = String(country || '').trim();
  if (!raw) return 'USD';

  const normalized = raw.toUpperCase();
  return COUNTRY_CURRENCY_MAP[normalized] || COUNTRY_CURRENCY_MAP[raw.toUpperCase()] || 'USD';
}

function getDefaultPaymentMethodsForCountry(country) {
  const raw = String(country || '').trim();
  if (!raw) return COUNTRY_PAYMENT_METHODS_MAP.DEFAULT.join(', ');

  const normalized = raw.toUpperCase();
  const methods = COUNTRY_PAYMENT_METHODS_MAP[normalized]
    || (['FR', 'DE', 'ES', 'IT', 'BE', 'PT', 'NL', 'IE', 'LU', 'GR', 'FI', 'AT'].includes(normalized)
      ? COUNTRY_PAYMENT_METHODS_MAP.EU
      : null)
    || COUNTRY_PAYMENT_METHODS_MAP.DEFAULT;

  return methods.join(', ');
}

module.exports = {
  getSupportedCurrencyOptions: buildCurrencyOptions,
  getPreferredCurrencyForCountry,
  getDefaultPaymentMethodsForCountry
};
