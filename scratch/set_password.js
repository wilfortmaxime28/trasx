const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function run() {
  try {
    const hash = await bcrypt.hash('password', 10);
    await db.query('UPDATE users SET password_hash = ? WHERE email = ?', [hash, 'cameron@example.com']);
    console.log('Successfully updated Cameron\'s password to "password"');
    process.exit(0);
  } catch (error) {
    console.error('Error updating password:', error);
    process.exit(1);
  }
}

run();
