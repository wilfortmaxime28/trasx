const db = require('../config/db');

async function migrate() {
  try {
    console.log('Starting migration for admin balance...');
    
    // Check columns on admins table
    const [columns] = await db.query('SHOW COLUMNS FROM admins');
    const colNames = columns.map(c => c.Field);
    
    if (!colNames.includes('balance')) {
      console.log('Adding balance column...');
      await db.query('ALTER TABLE admins ADD COLUMN balance DECIMAL(10,2) DEFAULT 0.00');
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
