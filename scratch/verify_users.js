const db = require('../config/db');

async function main() {
  try {
    console.log('Verifying all users in database...');
    await db.query('UPDATE users SET is_verified = 1');
    console.log('Successfully marked all users as verified!');
    process.exit(0);
  } catch (err) {
    console.error('Error verifying users:', err);
    process.exit(1);
  }
}

main();
