const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function main() {
  try {
    const username = 'testuser';
    const email = 'testuser@example.com';
    const password = 'password123';
    const first_name = 'Test';
    const last_name = 'User';
    const dob = '2000-01-01';
    const phone = '1234567890';
    const country = 'US';

    // Check if user already exists
    const [existing] = await db.query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing.length > 0) {
      console.log('Test user already exists. Updating password and verification state...');
      const password_hash = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET password_hash = ?, is_verified = 1, account_status = "Active" WHERE id = ?',
        [password_hash, existing[0].id]
      );
      console.log('Updated user ID:', existing[0].id);
      process.exit(0);
    }

    const password_hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name, dob, phone, country, is_verified, account_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'Active')`,
      [username, email, password_hash, first_name, last_name, dob, phone, country]
    );

    console.log('Created test user with ID:', result.insertId);
    process.exit(0);
  } catch (err) {
    console.error('Failed to create test user:', err);
    process.exit(1);
  }
}

main();
