const db = require('../config/db');

async function run() {
  try {
    const [tables] = await db.query("SHOW TABLES LIKE 'bookmarks'");
    if (tables.length === 0) {
      console.log('bookmarks table DOES NOT EXIST! Creating it...');
      await db.query(`
        CREATE TABLE bookmarks (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          post_id INT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          UNIQUE KEY unique_user_post (user_id, post_id)
        )
      `);
      console.log('bookmarks table created successfully.');
    } else {
      console.log('bookmarks table already exists.');
      const [columns] = await db.query("SHOW COLUMNS FROM bookmarks");
      console.log('Columns:', columns);
      const [rows] = await db.query("SELECT * FROM bookmarks");
      console.log('Current bookmarks:', rows);
    }
    process.exit(0);
  } catch (error) {
    console.error('Error in database check:', error);
    process.exit(1);
  }
}

run();
