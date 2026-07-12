const db = require('../config/db');

async function main() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      recipient_id INT NOT NULL,
      actor_id INT NOT NULL,
      type ENUM('like', 'comment', 'share', 'follow', 'mention', 'message') NOT NULL,
      message VARCHAR(255) NOT NULL,
      post_id INT DEFAULT NULL,
      share_id INT DEFAULT NULL,
      comment_id INT DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      read_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (share_id) REFERENCES post_shares(id) ON DELETE CASCADE,
      FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
      INDEX idx_notifications_recipient_read (recipient_id, is_read, created_at)
    )
  `);

  console.log('notifications table ready');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
