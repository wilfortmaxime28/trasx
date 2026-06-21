const db = require('../config/db');

async function main() {
  try {
    console.log('Checking post_shares table schema...');

    const [tables] = await db.query("SHOW TABLES LIKE 'post_shares'");
    if (tables.length === 0) {
      await db.query(`
        CREATE TABLE post_shares (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          sharer_id INT NOT NULL,
          recipient_user_id INT DEFAULT NULL,
          channel VARCHAR(50) NOT NULL DEFAULT 'social',
          platform VARCHAR(50) DEFAULT NULL,
          share_token VARCHAR(64) NOT NULL UNIQUE,
          clicked_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          FOREIGN KEY (sharer_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
          INDEX idx_post_shares_post_clicked (post_id, clicked_at)
        )
      `);
      console.log('Successfully created post_shares table.');
    } else {
      console.log('post_shares table already exists.');
    }

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

main();
