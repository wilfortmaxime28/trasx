const db = require('../config/db');

let hiddenPostSchemaPromise = null;

async function ensureHiddenPostSchema() {
  if (!hiddenPostSchemaPromise) {
    hiddenPostSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS hidden_posts (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          post_id INT NOT NULL,
          hidden_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_hidden_post (user_id, post_id),
          INDEX idx_hidden_posts_user (user_id),
          INDEX idx_hidden_posts_post (post_id)
        )
      `);
    })().catch((error) => {
      hiddenPostSchemaPromise = null;
      throw error;
    });
  }

  return hiddenPostSchemaPromise;
}

class HiddenPost {
  static async ensureSchema() {
    await ensureHiddenPostSchema();
  }

  static async hide(userId, postId) {
    await ensureHiddenPostSchema();
    await db.query(
      `
        INSERT INTO hidden_posts (user_id, post_id)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE hidden_at = CURRENT_TIMESTAMP
      `,
      [userId, postId]
    );
  }

  static async unhide(userId, postId) {
    await ensureHiddenPostSchema();
    await db.query(
      'DELETE FROM hidden_posts WHERE user_id = ? AND post_id = ?',
      [userId, postId]
    );
  }

  static async getHiddenPostsForUser(userId) {
    await ensureHiddenPostSchema();
    const [rows] = await db.query(
      `
        SELECT
          hp.post_id,
          hp.hidden_at,
          p.content,
          p.image_url,
          p.image_url_2,
          p.image_url_3,
          p.image_url_4,
          p.media_type,
          p.thumbnail_url,
          p.created_at,
          p.user_id AS author_id,
          CONCAT(u.first_name, ' ', u.last_name) AS author_name,
          u.username AS author_username,
          u.avatar AS author_avatar
        FROM hidden_posts hp
        JOIN posts p ON p.id = hp.post_id
        JOIN users u ON u.id = p.user_id
        WHERE hp.user_id = ?
        ORDER BY hp.hidden_at DESC
      `,
      [userId]
    );
    return rows;
  }
}

module.exports = HiddenPost;
