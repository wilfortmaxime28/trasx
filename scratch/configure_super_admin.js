const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function configureSuperAdmin() {
  try {
    const email = 'wilfortmaxime28@gmail.com';
    const password = 'maximeAdmin2026!';
    const hash = await bcrypt.hash(password, 10);

    // Update the super admin account (where is_super_admin = 1)
    const [result] = await db.query(
      `UPDATE admins 
       SET email = ?, 
           password_hash = ? 
       WHERE is_super_admin = 1`,
      [email, hash]
    );

    if (result.affectedRows === 0) {
      console.log('No super admin found (is_super_admin = 1). Creating one...');
      await db.query(
        `INSERT INTO admins (email, password_hash, is_super_admin) VALUES (?, ?, 1)`,
        [email, hash]
      );
      console.log('Super admin created successfully.');
    } else {
      console.log('Super admin email and password updated successfully.');
    }

    console.log('--- CREDENTIALS ---');
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    process.exit(0);
  } catch (error) {
    console.error('Error configuring super admin:', error);
    process.exit(1);
  }
}

configureSuperAdmin();
