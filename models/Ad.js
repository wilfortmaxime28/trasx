const db = require('../config/db');

let adSchemaPromise = null;

async function ensureAdsTable() {
  if (!adSchemaPromise) {
    adSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ads (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT NOT NULL,
          image_url VARCHAR(255) NOT NULL,
          ad_url VARCHAR(255) NOT NULL,
          days INT NOT NULL DEFAULT 1,
          total_price DECIMAL(10,2) NOT NULL DEFAULT 5.00,
          send_notification TINYINT(1) DEFAULT 0,
          show_in_feed TINYINT(1) DEFAULT 0,
          expires_at DATETIME NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      // Dynamic migration to add columns if they don't exist
      const [columns] = await db.query("SHOW COLUMNS FROM ads");
      const columnNames = columns.map(col => col.Field);
      if (!columnNames.includes('send_notification')) {
        await db.query("ALTER TABLE ads ADD COLUMN send_notification TINYINT(1) DEFAULT 0");
      }
      if (!columnNames.includes('show_in_feed')) {
        await db.query("ALTER TABLE ads ADD COLUMN show_in_feed TINYINT(1) DEFAULT 0");
      }
    })().catch((error) => {
      adSchemaPromise = null;
      throw error;
    });
  }
  return adSchemaPromise;
}

class Ad {
  static async getActiveAds() {
    await ensureAdsTable();
    const [rows] = await db.query(`
      SELECT a.*, u.username, u.avatar, u.first_name, u.last_name
      FROM ads a
      JOIN users u ON a.user_id = u.id
      WHERE a.expires_at > NOW()
      ORDER BY a.created_at DESC
    `);
    return rows;
  }

  static async create({ userId, title, description, imageUrl, adUrl, days, totalPrice, sendNotification = 0, showInFeed = 0 }) {
    await ensureAdsTable();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const [result] = await db.query(`
      INSERT INTO ads (user_id, title, description, image_url, ad_url, days, total_price, send_notification, show_in_feed, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, title, description, imageUrl, adUrl, days, totalPrice, sendNotification, showInFeed, expiresAt]);
    return result.insertId;
  }
}

module.exports = Ad;
