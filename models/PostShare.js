const crypto = require('node:crypto');
const db = require('../config/db');

class PostShare {
  static async create({ postId, sharerId, recipientUserId = null, channel = 'social', platform = null }) {
    const shareToken = crypto.randomBytes(16).toString('hex');
    const [result] = await db.query(
      `
        INSERT INTO post_shares (
          post_id,
          sharer_id,
          recipient_user_id,
          channel,
          platform,
          share_token
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [postId, sharerId, recipientUserId, channel, platform, shareToken]
    );

    return {
      id: result.insertId,
      shareToken
    };
  }

  static async getByToken(shareToken) {
    const [rows] = await db.query(
      `
        SELECT
          ps.id,
          ps.post_id,
          ps.sharer_id,
          ps.recipient_user_id,
          ps.channel,
          ps.platform,
          ps.share_token,
          ps.clicked_at,
          ps.created_at,
          CONCAT(u.first_name, ' ', u.last_name) AS sharer_name,
          u.username AS sharer_username,
          u.avatar AS sharer_avatar
        FROM post_shares ps
        JOIN users u ON ps.sharer_id = u.id
        WHERE ps.share_token = ?
        LIMIT 1
      `,
      [shareToken]
    );
    return rows[0] || null;
  }

  static async markClicked(shareToken) {
    const [result] = await db.query(
      `
        UPDATE post_shares
        SET clicked_at = NOW()
        WHERE share_token = ? AND clicked_at IS NULL
      `,
      [shareToken]
    );
    return result.affectedRows > 0;
  }

  static async getClickedCount(postId) {
    const [rows] = await db.query(
      `
        SELECT COUNT(*) AS count
        FROM post_shares
        WHERE post_id = ? AND clicked_at IS NOT NULL
      `,
      [postId]
    );
    return Number(rows[0]?.count || 0);
  }

  static async addDirectShare(postId, sharerId, channel = 'download', platform = 'download') {
    const shareToken = crypto.randomBytes(16).toString('hex');
    await db.query(
      `
        INSERT INTO post_shares (
          post_id,
          sharer_id,
          channel,
          platform,
          share_token,
          clicked_at
        ) VALUES (?, ?, ?, ?, ?, NOW())
      `,
      [postId, sharerId, channel, platform, shareToken]
    );
  }
}

module.exports = PostShare;
