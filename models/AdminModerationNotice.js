const db = require('../config/db');

let adminModerationNoticeSchemaPromise = null;

async function ensureAdminModerationNoticeSchema() {
  if (!adminModerationNoticeSchemaPromise) {
    adminModerationNoticeSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS admin_moderation_notices (
          id INT AUTO_INCREMENT PRIMARY KEY,
          admin_id INT NOT NULL,
          target_user_id INT NOT NULL,
          target_type ENUM('profile', 'post') NOT NULL,
          post_id INT DEFAULT NULL,
          reason VARCHAR(120) NOT NULL,
          details TEXT DEFAULT NULL,
          status ENUM('active', 'resolved', 'dismissed') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_admin_moderation_target_user (target_user_id),
          INDEX idx_admin_moderation_target_type (target_type),
          INDEX idx_admin_moderation_status (status),
          INDEX idx_admin_moderation_post (post_id)
        )
      `);
    })().catch((error) => {
      adminModerationNoticeSchemaPromise = null;
      throw error;
    });
  }

  return adminModerationNoticeSchemaPromise;
}

class AdminModerationNotice {
  static async createOrUpdateActive({ adminId, targetUserId, targetType, postId = null, reason, details = null }) {
    await ensureAdminModerationNoticeSchema();

    const normalizedPostId = targetType === 'post' ? Number(postId) : null;
    const query = targetType === 'post'
      ? `
          SELECT id
          FROM admin_moderation_notices
          WHERE target_user_id = ?
            AND target_type = 'post'
            AND post_id = ?
            AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        `
      : `
          SELECT id
          FROM admin_moderation_notices
          WHERE target_user_id = ?
            AND target_type = 'profile'
            AND post_id IS NULL
            AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        `;

    const queryParams = targetType === 'post'
      ? [targetUserId, normalizedPostId]
      : [targetUserId];

    const [existingRows] = await db.query(query, queryParams);
    const existingNotice = existingRows[0];

    if (existingNotice) {
      await db.query(
        `
          UPDATE admin_moderation_notices
          SET admin_id = ?,
              reason = ?,
              details = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [adminId, reason, details, existingNotice.id]
      );
      return existingNotice.id;
    }

    const [result] = await db.query(
      `
        INSERT INTO admin_moderation_notices (
          admin_id,
          target_user_id,
          target_type,
          post_id,
          reason,
          details
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [adminId, targetUserId, targetType, normalizedPostId, reason, details]
    );

    return result.insertId || 0;
  }

  static async getActiveForUser(userId) {
    await ensureAdminModerationNoticeSchema();
    const [rows] = await db.query(
      `
        SELECT
          amn.id,
          amn.target_type,
          amn.reason,
          amn.details,
          amn.post_id,
          amn.created_at,
          amn.updated_at,
          p.content AS post_content,
          p.image_url AS post_image_url,
          p.thumbnail_url AS post_thumbnail_url
        FROM admin_moderation_notices amn
        LEFT JOIN posts p ON p.id = amn.post_id
        WHERE amn.target_user_id = ?
          AND amn.status = 'active'
        ORDER BY amn.updated_at DESC, amn.created_at DESC
      `,
      [userId]
    );
    return rows;
  }

  static async getRecent(limit = 40) {
    await ensureAdminModerationNoticeSchema();
    const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 40;
    const [rows] = await db.query(
      `
        SELECT
          amn.id,
          amn.target_type,
          amn.reason,
          amn.details,
          amn.status,
          amn.post_id,
          amn.created_at,
          amn.updated_at,
          target.username AS target_username,
          CONCAT(target.first_name, ' ', target.last_name) AS target_name,
          admin.email AS admin_email,
          p.content AS post_content
        FROM admin_moderation_notices amn
        JOIN users target ON target.id = amn.target_user_id
        LEFT JOIN admins admin ON admin.id = amn.admin_id
        LEFT JOIN posts p ON p.id = amn.post_id
        ORDER BY amn.updated_at DESC, amn.created_at DESC
        LIMIT ?
      `,
      [safeLimit]
    );
    return rows;
  }
}

module.exports = AdminModerationNotice;
