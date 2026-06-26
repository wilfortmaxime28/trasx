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
    statusId = null,
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
          status_id,
          ad_url,
          ad_image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [recipientId, actorId, type, truncatedMessage, postId, shareId, commentId, statusId, adUrl, adImageUrl]
    );

    const insertId = result.insertId;

    // Trigger push notification asynchronously in the background
    (async () => {
      try {
        const [subs] = await db.query(
          'SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?',
          [recipientId]
        );
        if (subs && subs.length > 0) {
          const webpush = require('web-push');
          const payload = JSON.stringify({
            title: 'TrasX',
            body: truncatedMessage,
            url: type === 'message' ? '/?view=messages' : (type === 'game' ? '/?view=games' : '/?view=notifications'),
            type: type
          });

          for (const sub of subs) {
            const pushSubscription = {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.keys_p256dh,
                auth: sub.keys_auth
              }
            };

            webpush.sendNotification(pushSubscription, payload).catch((pushErr) => {
              console.error('Push notification sending failed for endpoint:', sub.endpoint, pushErr.statusCode);
              if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                // Remove expired/invalid subscriptions from db
                db.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [sub.endpoint]).catch(() => {});
              }
            });
          }
        }
      } catch (err) {
        console.error('Error dispatching push notifications:', err);
      }
    })();

    return insertId;
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
          n.status_id,
          n.ad_url,
          n.ad_image_url,
          n.is_read,
          n.read_at,
          n.created_at,
          COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name), 'TrasX') AS actor_name,
          COALESCE(u.username, 'trasx') AS actor_username,
          COALESCE(u.avatar, '/assets/avatar_placeholder.jpg') AS actor_avatar,
          CASE 
            WHEN p.content IS NOT NULL AND TRIM(p.content) != '' THEN p.content
            WHEN p.media_type IS NOT NULL AND p.media_type != '' THEN CONCAT('[', p.media_type, ']')
            ELSE NULL
          END AS post_content,
          s2.media_url AS status_media_url,
          s2.media_type AS status_media_type,
          s2.caption AS status_caption,
          s2.bg_color AS status_bg_color
        FROM notifications n
        LEFT JOIN users u ON n.actor_id = u.id
        LEFT JOIN posts p ON n.post_id = p.id
        LEFT JOIN statuses s2 ON n.status_id = s2.id
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
