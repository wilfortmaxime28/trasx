const db = require('../config/db');

async function debugDb() {
  try {
    const [dbNameRows] = await db.query("SELECT DATABASE() as db");
    console.log('Current DB:', dbNameRows[0].db);
    const [rows] = await db.query("SELECT * FROM admins");
    console.log('Admins in DB:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

debugDb();
