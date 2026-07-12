const db = require('../config/db');

async function listAdmins() {
  try {
    const [rows] = await db.query('SELECT id, email, display_name, is_super_admin FROM admins');
    console.log('--- ADMIN LIST ---');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error listing admins:', error);
    process.exit(1);
  }
}

listAdmins();
