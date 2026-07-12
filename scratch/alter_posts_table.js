const db = require('../config/db');

async function main() {
  try {
    console.log('Adding media_type column to posts table...');
    await db.query('ALTER TABLE posts ADD COLUMN media_type VARCHAR(20) DEFAULT NULL');
    console.log('Successfully added media_type column!');
    process.exit(0);
  } catch (err) {
    console.error('Error altering table:', err);
    process.exit(1);
  }
}

main();
