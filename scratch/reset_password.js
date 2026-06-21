const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function run() {
  try {
    const password = 'password';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    
    // Update wilfortmaxime28@gmail.com (id 15) password
    await db.query('UPDATE users SET password_hash = ? WHERE email = ?', [hash, 'wilfortmaxime28@gmail.com']);
    console.log('Password hash updated for wilfortmaxime28@gmail.com successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error updating password:', error);
    process.exit(1);
  }
}

run();
