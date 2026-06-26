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
          target_type ENUM('profile', 'post', 'reel') NOT NULL,
          post_id INT DEFAULT NULL,
          reel_id INT DEFAULT NULL,
          reason VARCHAR(120) NOT NULL,
          details TEXT DEFAULT NULL,
          status ENUM('active', 'resolved', 'dismissed') NOT NULL DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_admin_moderation_target_user (target_user_id),
          INDEX idx_admin_moderation_target_type (target_type),
          INDEX idx_admin_moderation_status (status),
          INDEX idx_admin_moderation_post (post_id),
          INDEX idx_admin_moderation_reel (reel_id)
        )
      `);

      // Migration: Check and modify target_type to support 'reel' if table already exists
      const [typeCols] = await db.query("SHOW COLUMNS FROM admin_moderation_notices LIKE 'target_type'");
      if (typeCols && typeCols.length > 0) {
        const typeDefine = typeCols[0].Type || '';
        if (!typeDefine.includes('reel')) {
          await db.query("ALTER TABLE admin_moderation_notices MODIFY COLUMN target_type ENUM('profile', 'post', 'reel') NOT NULL");
        }
      }

      // Migration: Add reel_id column if table already exists
      const [reelIdCols] = await db.query("SHOW COLUMNS FROM admin_moderation_notices LIKE 'reel_id'");
      if (!reelIdCols || reelIdCols.length === 0) {
        await db.query("ALTER TABLE admin_moderation_notices ADD COLUMN reel_id INT DEFAULT NULL AFTER post_id");
        await db.query("ALTER TABLE admin_moderation_notices ADD INDEX idx_admin_moderation_reel (reel_id)");
      }
    })().catch((error) => {
      adminModerationNoticeSchemaPromise = null;
      throw error;
    });
  }

  return adminModerationNoticeSchemaPromise;
}

class AdminModerationNotice {
  static async createOrUpdateActive({ adminId, targetUserId, targetType, postId = null, reelId = null, reason, details = null }) {
    await ensureAdminModerationNoticeSchema();

    const normalizedPostId = targetType === 'post' ? Number(postId) : null;
    const normalizedReelId = targetType === 'reel' ? Number(reelId) : null;
    
    let query = '';
    let queryParams = [];

    if (targetType === 'post') {
      query = `
        SELECT id
        FROM admin_moderation_notices
        WHERE target_user_id = ?
          AND target_type = 'post'
          AND post_id = ?
          AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `;
      queryParams = [targetUserId, normalizedPostId];
    } else if (targetType === 'reel') {
      query = `
        SELECT id
        FROM admin_moderation_notices
        WHERE target_user_id = ?
          AND target_type = 'reel'
          AND reel_id = ?
          AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `;
      queryParams = [targetUserId, normalizedReelId];
    } else {
      query = `
        SELECT id
        FROM admin_moderation_notices
        WHERE target_user_id = ?
          AND target_type = 'profile'
          AND post_id IS NULL
          AND reel_id IS NULL
          AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `;
      queryParams = [targetUserId];
    }

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
          reel_id,
          reason,
          details
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [adminId, targetUserId, targetType, normalizedPostId, normalizedReelId, reason, details]
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
          amn.reel_id,
          amn.created_at,
          amn.updated_at,
          p.content AS post_content,
          p.image_url AS post_image_url,
          p.image_url_2 AS post_image_url_2,
          p.image_url_3 AS post_image_url_3,
          p.image_url_4 AS post_image_url_4,
          p.media_type AS post_media_type,
          p.bg_image_url AS post_bg_image_url,
          p.text_color AS post_text_color,
          p.text_alignment AS post_text_alignment,
          p.text_position AS post_text_position,
          p.text_font AS post_text_font,
          p.text_size AS post_text_size,
          p.is_live AS post_is_live,
          p.live_url AS post_live_url,
          p.live_status AS post_live_status,
          p.is_trade AS post_is_trade,
          p.trade_price AS post_trade_price,
          p.thumbnail_url AS post_thumbnail_url,
          r.caption AS reel_caption,
          r.video_url AS reel_video_url,
          r.sound_name AS reel_sound_name,
          r.media_type AS reel_media_type,
          r.audio_url AS reel_audio_url,
          r.media_fit AS reel_media_fit,
          r.is_trade AS reel_is_trade,
          r.trade_price AS reel_trade_price
        FROM admin_moderation_notices amn
        LEFT JOIN posts p ON p.id = amn.post_id
        LEFT JOIN reels r ON r.id = amn.reel_id
        WHERE amn.target_user_id = ?
          AND amn.status = 'active'
          AND amn.created_at >= NOW() - INTERVAL 72 HOUR
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
