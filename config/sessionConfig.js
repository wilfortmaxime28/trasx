const ONE_DAY_MS = 1000 * 60 * 60 * 24;
const ONE_YEAR_MS = ONE_DAY_MS * 365;
const ONE_HOUR_MS = 1000 * 60 * 60;

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'trasx.sid';
const SESSION_SECRET = process.env.SESSION_SECRET || 'weshare_super_secret_key_123';
const SESSION_MAX_AGE_MS = Math.max(
  ONE_DAY_MS,
  Number(process.env.SESSION_MAX_AGE_MS || 0) || ONE_YEAR_MS
);
const SESSION_CLEANUP_INTERVAL_MS = Math.max(
  60 * 1000,
  Number(process.env.SESSION_CLEANUP_INTERVAL_MS || 0) || ONE_HOUR_MS
);

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_SECRET,
  SESSION_MAX_AGE_MS,
  SESSION_CLEANUP_INTERVAL_MS
};
