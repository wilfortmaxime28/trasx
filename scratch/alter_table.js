const db = require('../config/db');

async function run() {
  try {
    console.log('Altering comments table to add voice_url column...');
    
    // Check if column already exists
    const [columns] = await db.query("SHOW COLUMNS FROM comments LIKE 'voice_url'");
    if (columns.length === 0) {
      await db.query("ALTER TABLE comments ADD COLUMN voice_url VARCHAR(500) DEFAULT NULL");
      console.log('voice_url column added successfully.');
    } else {
      console.log('voice_url column already exists.');
    }
    
    // Also, check parent_id column just in case
    const [parentIdCol] = await db.query("SHOW COLUMNS FROM comments LIKE 'parent_id'");
    if (parentIdCol.length === 0) {
      await db.query("ALTER TABLE comments ADD COLUMN parent_id INT DEFAULT NULL, ADD FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE");
      console.log('parent_id column added successfully.');
    } else {
      console.log('parent_id column already exists.');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error migrating DB:', error);
    process.exit(1);
  }
}

run();
