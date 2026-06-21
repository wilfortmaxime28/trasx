const db = require('../config/db');

async function migrate() {
  try {
    console.log('Starting migration for trade posts...');
    
    // Check columns on posts table
    const [columns] = await db.query('SHOW COLUMNS FROM posts');
    const colNames = columns.map(c => c.Field);
    
    if (!colNames.includes('is_trade')) {
      console.log('Adding is_trade column...');
      await db.query('ALTER TABLE posts ADD COLUMN is_trade TINYINT(1) DEFAULT 0');
    }
    
    if (!colNames.includes('trade_price')) {
      console.log('Adding trade_price column...');
      await db.query('ALTER TABLE posts ADD COLUMN trade_price DECIMAL(10,2) DEFAULT NULL');
    }
    
    if (!colNames.includes('last_possession_user_id')) {
      console.log('Adding last_possession_user_id column...');
      await db.query('ALTER TABLE posts ADD COLUMN last_possession_user_id INT(11) DEFAULT NULL');
      try {
        await db.query('ALTER TABLE posts ADD CONSTRAINT fk_last_possession FOREIGN KEY (last_possession_user_id) REFERENCES users(id) ON DELETE SET NULL');
      } catch (err) {
        console.log('Constraint fk_last_possession could not be created or already exists:', err.message);
      }
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
