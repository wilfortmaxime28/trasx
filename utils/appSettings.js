const db = require('../config/db');

async function getSetting(settingKey, defaultValue = null) {
  const [rows] = await db.query(
    'SELECT setting_value FROM app_settings WHERE setting_key = ? LIMIT 1',
    [settingKey]
  );

  if (!rows || rows.length === 0) {
    return defaultValue;
  }

  return rows[0].setting_value ?? defaultValue;
}

async function getNumberSetting(settingKey, defaultValue = 0) {
  const value = await getSetting(settingKey, defaultValue);
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

async function setSetting(settingKey, settingValue) {
  await db.query(
    `
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
    `,
    [settingKey, String(settingValue)]
  );
}

module.exports = {
  getSetting,
  getNumberSetting,
  setSetting
};
