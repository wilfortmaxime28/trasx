const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function setAdminPassword() {
  try {
    const email = 'wilfortmaxime917@gmail.com';
    const password = 'admin123';
    const hash = await bcrypt.hash(password, 10);

    await db.query(
      `UPDATE admins SET password_hash = ? WHERE email = ?`,
      [hash, email]
    );

    console.log(`--- ADMIN PASSWORD UPDATED ---`);
    console.log(`Email: ${email}`);
    console.log(`New Password: ${password}`);
    process.exit(0);
  } catch (error) {
    console.error('Error updating admin password:', error);
    process.exit(1);
  }
}

setAdminPassword();
