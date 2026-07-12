const db = require('../config/db');

async function checkSmtp() {
  try {
    const [rows] = await db.query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'smtp_%'");
    console.log('--- SMTP SETTINGS ---');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error checking SMTP settings:', error);
    process.exit(1);
  }
}

checkSmtp();
