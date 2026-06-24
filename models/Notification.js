const db = require('../config/db');

let notificationSchemaPromise = null;

async function ensureNotificationSchema() {
  if (!notificationSchemaPromise) {
    notificationSchemaPromise = (async () => {
      const [actorRows] = await db.query('SHOW COLUMNS FROM notifications LIKE ?', ['actor_id']);
      if (!actorRows || actorRows.length === 0) {
        await db.query('ALTER TABLE notifications ADD COLUMN actor_id INT DEFAULT NULL AFTER recipient_id');
      } else if (String(actorRows[0].Null || '').toUpperCase() === 'NO') {
        await db.query('ALTER TABLE notifications MODIFY COLUMN actor_id INT DEFAULT NULL');
      }

      // Check the 'type' enum column to support new realtime notification kinds
      const [typeRows] = await db.query('SHOW COLUMNS FROM notifications LIKE ?', ['type']);
      if (typeRows && typeRows.length > 0) {
        const typeDefine = typeRows[0].Type || '';
        if (!typeDefine.includes('game') || !typeDefine.includes('gift') || !typeDefine.includes('market')) {
          await db.query("ALTER TABLE notifications MODIFY COLUMN type ENUM('like', 'comment', 'share', 'follow', 'mention', 'message', 'ad-published', 'game', 'gift', 'market') NOT NULL");
        }
      }

      // Check the 'ad_url' column to support clickable ads in notifications
      const [adUrlRows] = await db.query('SHOW COLUMNS FROM notifications LIKE ?', ['ad_url']);
      if (!adUrlRows || adUrlRows.length === 0) {
        await db.query('ALTER TABLE notifications ADD COLUMN ad_url VARCHAR(255) DEFAULT NULL AFTER comment_id');
      }

      // Check the 'ad_image_url' column to support rendering ad banners in notifications
      const [adImageRows] = await db.query('SHOW COLUMNS FROM notifications LIKE ?', ['ad_image_url']);
      if (!adImageRows || adImageRows.length === 0) {
        await db.query('ALTER TABLE notifications ADD COLUMN ad_image_url VARCHAR(255) DEFAULT NULL AFTER ad_url');
      }
    })().catch((error) => {
      notificationSchemaPromise = null;
      throw error;
    });
  }

  return notificationSchemaPromise;
}

class Notification {
  static async create({
    recipientId,
    actorId = null,
    type,
    message,
    postId = null,
    shareId = null,
    commentId = null,
    adUrl = null,
    adImageUrl = null,
    connection = db
  }) {
    await ensureNotificationSchema();
    const truncatedMessage = String(message || '').slice(0, 255);
    const [result] = await connection.query(
      `
        INSERT INTO notifications (
          recipient_id,
          actor_id,
          type,
          message,
          post_id,
          share_id,
          comment_id,
          ad_url,
          ad_image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [recipientId, actorId, type, truncatedMessage, postId, shareId, commentId, adUrl, adImageUrl]
    );

    return result.insertId;
  }

  static async getRecentForUser(userId, limit = 12) {
    await ensureNotificationSchema();
    const [rows] = await db.query(
      `
        SELECT
          n.id,
          n.recipient_id,
          n.actor_id,
          n.type,
          n.message,
          n.post_id,
          n.share_id,
          n.comment_id,
          n.ad_url,
          n.ad_image_url,
          n.is_read,
          n.read_at,
          n.created_at,
          COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name), 'TrasX') AS actor_name,
          COALESCE(u.username, 'trasx') AS actor_username,
          COALESCE(u.avatar, '/assets/avatar_placeholder.jpg') AS actor_avatar
        FROM notifications n
        LEFT JOIN users u ON n.actor_id = u.id
        WHERE n.recipient_id = ?
        ORDER BY n.created_at DESC
        LIMIT ?
      `,
      [userId, limit]
    );
    return rows;
  }

  static async getUnreadCount(userId) {
    const [rows] = await db.query(
      'SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND is_read = 0',
      [userId]
    );
    return Number(rows[0]?.count || 0);
  }

  static async markAllRead(userId) {
    const [result] = await db.query(
      `
        UPDATE notifications
        SET is_read = 1,
            read_at = NOW()
        WHERE recipient_id = ? AND is_read = 0
      `,
      [userId]
    );
    return result.affectedRows;
  }

  static async markSingleRead(notificationId, userId) {
    const [result] = await db.query(
      `
        UPDATE notifications
        SET is_read = 1,
            read_at = NOW()
        WHERE id = ? AND recipient_id = ? AND is_read = 0
      `,
      [notificationId, userId]
    );
    return result.affectedRows;
  }
}

module.exports = Notification;
