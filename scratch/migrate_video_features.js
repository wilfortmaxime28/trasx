const db = require('../config/db');

async function main() {
  try {
    console.log('Checking posts table schema...');

    // Fetch existing columns to see if they exist
    const [cols] = await db.query('SHOW COLUMNS FROM posts');
    const columnNames = cols.map(c => c.Field);

    if (!columnNames.includes('thumbnail_url')) {
      console.log('Adding column thumbnail_url...');
      await db.query('ALTER TABLE posts ADD COLUMN thumbnail_url VARCHAR(255) DEFAULT NULL');
      console.log('Successfully added thumbnail_url column!');
    } else {
      console.log('Column thumbnail_url already exists.');
    }

    if (!columnNames.includes('allow_download')) {
      console.log('Adding column allow_download...');
      await db.query('ALTER TABLE posts ADD COLUMN allow_download TINYINT(1) DEFAULT 1');
      console.log('Successfully added allow_download column!');
    } else {
      console.log('Column allow_download already exists.');
    }

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
