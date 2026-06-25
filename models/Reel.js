const db = require('../config/db');

class Reel {
  static async ensureReelSchema() {
    if (Reel._schemaReady) return;

    const [tableExists] = await db.query("SHOW TABLES LIKE 'reels'");
    if (!tableExists || tableExists.length === 0) {
      console.log('Reels table does not exist yet. Skipping reel schema check.');
      return;
    }

    const [columns] = await db.query('SHOW COLUMNS FROM reels');
    const columnNames = new Set(columns.map((column) => column.Field));

    if (!columnNames.has('media_fit')) {
      await db.query("ALTER TABLE reels ADD COLUMN media_fit VARCHAR(20) NOT NULL DEFAULT 'cover'");
    }
    if (!columnNames.has('is_trade')) {
      await db.query('ALTER TABLE reels ADD COLUMN is_trade TINYINT(1) DEFAULT 0');
    }
    if (!columnNames.has('trade_price')) {
      await db.query('ALTER TABLE reels ADD COLUMN trade_price DECIMAL(10,2) DEFAULT NULL');
    }
    if (!columnNames.has('last_possession_user_id')) {
      await db.query('ALTER TABLE reels ADD COLUMN last_possession_user_id INT DEFAULT NULL');
    }
    if (!columnNames.has('next_trade_payout_admin')) {
      await db.query('ALTER TABLE reels ADD COLUMN next_trade_payout_admin TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!columnNames.has('promo_daily_target')) {
      await db.query('ALTER TABLE reels ADD COLUMN promo_daily_target INT NOT NULL DEFAULT 0');
    }
    if (!columnNames.has('promo_paid_hashtag_count')) {
      await db.query('ALTER TABLE reels ADD COLUMN promo_paid_hashtag_count INT NOT NULL DEFAULT 0');
    }
    if (!columnNames.has('trim_start')) {
      await db.query('ALTER TABLE reels ADD COLUMN trim_start FLOAT DEFAULT NULL');
    }
    if (!columnNames.has('trim_end')) {
      await db.query('ALTER TABLE reels ADD COLUMN trim_end FLOAT DEFAULT NULL');
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS reel_daily_unique_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reel_id INT NOT NULL,
        viewer_user_id INT NOT NULL,
        view_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_reel_viewer (reel_id, viewer_user_id),
        INDEX idx_reel_daily_views_date (view_date),
        INDEX idx_reel_daily_views_reel (reel_id)
      )
    `);

    // Migration: convert to unique view per user per reel (if not already migrated)
    const [reelIndexes] = await db.query("SHOW INDEX FROM reel_daily_unique_views");
    const hasReelNewUnique = reelIndexes.some(idx => idx.Key_name === 'uniq_reel_viewer');
    const hasReelOldUnique = reelIndexes.some(idx => idx.Key_name === 'uniq_reel_viewer_day');
    if (!hasReelNewUnique) {
      if (hasReelOldUnique) {
        await db.query("ALTER TABLE reel_daily_unique_views DROP KEY uniq_reel_viewer_day");
      }
      // Deduplicate rows (keep only first view per user per reel)
      await db.query(`
        DELETE t1 FROM reel_daily_unique_views t1
        INNER JOIN reel_daily_unique_views t2 
        WHERE t1.id > t2.id 
          AND t1.reel_id = t2.reel_id 
          AND t1.viewer_user_id = t2.viewer_user_id
      `);
      await db.query("ALTER TABLE reel_daily_unique_views ADD UNIQUE KEY uniq_reel_viewer (reel_id, viewer_user_id)");
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS reel_shared_audios (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        audio_url VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    Reel._schemaReady = true;
  }

  static async getAll(currentUserId) {
    await Reel.ensureReelSchema();
    const query = `
      SELECT 
        r.id,
        r.video_url,
        r.sound_name,
        r.caption,
        r.likes_count,
        r.comments_count,
        r.shares_count,
        (SELECT COUNT(*) FROM reel_daily_unique_views WHERE reel_id = r.id) AS views_count,
        r.created_at,
        r.media_type,
        r.audio_url,
        r.audio_start_time,
        r.audio_duration,
        r.media_fit,
        r.is_trade,
        r.trade_price,
        r.last_possession_user_id,
        r.trim_start,
        r.trim_end,
        r.next_trade_payout_admin,
        r.promo_daily_target,
        r.promo_paid_hashtag_count,
        r.user_id,
        COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS author_name,
        u.avatar AS author_avatar,
        u.username AS author_username,
        u.country AS author_country,
        u.certification_type AS author_certification_type,
        u.created_at AS author_created_at,
        (
          SELECT COUNT(*)
          FROM follows f2
          WHERE f2.following_id = r.user_id
        ) AS author_followers_count,
        EXISTS(
          SELECT 1
          FROM follows f
          WHERE f.follower_id = ? AND f.following_id = r.user_id
        ) AS is_author_following
      FROM reels r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.created_at DESC
    `;
    const [rows] = await db.query(query, [currentUserId]);
    return rows;
  }

  static async getByUserId(userId) {
    await Reel.ensureReelSchema();
    const query = `
      SELECT 
        r.id,
        r.video_url,
        r.sound_name,
        r.caption,
        r.likes_count,
        r.comments_count,
        r.shares_count,
        (SELECT COUNT(*) FROM reel_daily_unique_views WHERE reel_id = r.id) AS views_count,
        r.created_at,
        r.media_type,
        r.audio_url,
        r.audio_start_time,
        r.audio_duration,
        r.media_fit,
        r.is_trade,
        r.trade_price,
        r.last_possession_user_id,
        r.trim_start,
        r.trim_end,
        r.next_trade_payout_admin
      FROM reels r
      WHERE r.user_id = ?
      ORDER BY r.created_at DESC
    `;
    const [rows] = await db.query(query, [userId]);
    return rows;
  }

  static async getById(reelId) {
    await Reel.ensureReelSchema();
    const query = `
      SELECT 
        r.id,
        r.user_id,
        r.video_url,
        r.sound_name,
        r.caption,
        r.likes_count,
        r.comments_count,
        r.shares_count,
        r.created_at,
        r.media_type,
        r.audio_url,
        r.audio_start_time,
        r.audio_duration,
        r.media_fit,
        r.is_trade,
        r.trade_price,
        r.last_possession_user_id,
        r.trim_start,
        r.trim_end,
        r.next_trade_payout_admin
      FROM reels r
      WHERE r.id = ?
    `;
    const [rows] = await db.query(query, [reelId]);
    return rows[0] || null;
  }

  static async create({ user_id, video_url, sound_name, caption, media_type, audio_url, audio_start_time, audio_duration, media_fit, is_trade, trade_price, last_possession_user_id, promo_daily_target = 0, promo_paid_hashtag_count = 0, trim_start = null, trim_end = null }) {
    await Reel.ensureReelSchema();
    const mediaFit = media_fit === 'contain' ? 'contain' : 'cover';
    const query = `
      INSERT INTO reels 
        (user_id, video_url, sound_name, caption, media_type, audio_url, audio_start_time, audio_duration, media_fit, is_trade, trade_price, last_possession_user_id, promo_daily_target, promo_paid_hashtag_count, trim_start, trim_end) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(query, [
      user_id,
      video_url || null,
      sound_name || 'Original Audio',
      caption,
      media_type || 'video',
      audio_url || null,
      audio_start_time || 0,
      audio_duration || 30,
      mediaFit,
      is_trade ? 1 : 0,
      trade_price || null,
      last_possession_user_id || null,
      promo_daily_target || 0,
      promo_paid_hashtag_count || 0,
      trim_start,
      trim_end
    ]);
    return result.insertId;
  }

  static async getTodayUniqueViewCounts(reelIds) {
    await Reel.ensureReelSchema();
    const ids = Array.isArray(reelIds) ? reelIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    if (ids.length === 0) {
      return new Map();
    }

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await db.query(
      `
        SELECT reel_id, COUNT(*) AS views_count
        FROM reel_daily_unique_views
        WHERE view_date = CURDATE() AND reel_id IN (${placeholders})
        GROUP BY reel_id
      `,
      ids
    );

    return new Map(rows.map((row) => [Number(row.reel_id), Number(row.views_count || 0)]));
  }

  static async recordDailyViews(reelIds, viewerUserId) {
    await Reel.ensureReelSchema();
    const ids = Array.isArray(reelIds) ? reelIds.map((id) => Number(id)).filter(Number.isFinite) : [];
    const numericViewerUserId = Number(viewerUserId);
    if (ids.length === 0 || !Number.isFinite(numericViewerUserId)) {
      return;
    }

    const placeholders = ids.map(() => '?').join(', ');
    const params = [numericViewerUserId, ...ids, numericViewerUserId];

    await db.query(
      `
        INSERT IGNORE INTO reel_daily_unique_views (reel_id, viewer_user_id, view_date)
        SELECT id, ?, CURDATE()
        FROM reels
        WHERE id IN (${placeholders}) AND user_id != ?
      `,
      params
    );
  }

  static async getTotalLikesForUser(userId) {
    const query = `
      SELECT SUM(likes_count) as total 
      FROM reels 
      WHERE user_id = ?
    `;
    const [rows] = await db.query(query, [userId]);
    return rows[0].total || 0;
  }

  static async delete(reelId, userId) {
    await db.query('DELETE FROM reels WHERE id = ? AND user_id = ?', [reelId, userId]);
  }

  static async incrementLikes(reelId) {
    await db.query('UPDATE reels SET likes_count = likes_count + 1 WHERE id = ?', [reelId]);
  }

  static async decrementLikes(reelId) {
    await db.query('UPDATE reels SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?', [reelId]);
  }

  static async incrementComments(reelId) {
    await db.query('UPDATE reels SET comments_count = comments_count + 1 WHERE id = ?', [reelId]);
  }

  static async incrementShares(reelId) {
    await db.query('UPDATE reels SET shares_count = shares_count + 1 WHERE id = ?', [reelId]);
  }

  static async ensureReelCommentsTable() {
    const [reelsExist] = await db.query("SHOW TABLES LIKE 'reels'");
    const [usersExist] = await db.query("SHOW TABLES LIKE 'users'");
    if (!reelsExist || reelsExist.length === 0 || !usersExist || usersExist.length === 0) {
      console.log('Reels or Users table does not exist yet. Skipping reel comments table check.');
      return;
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS reel_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reel_id INT NOT NULL,
        user_id INT NOT NULL,
        parent_id INT DEFAULT NULL,
        content TEXT NOT NULL,
        voice_url VARCHAR(255) DEFAULT NULL,
        voice_duration_seconds INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reel_id) REFERENCES reels(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const [columns] = await db.query('SHOW COLUMNS FROM reel_comments');
    const columnNames = new Set(columns.map((column) => column.Field));
    if (!columnNames.has('parent_id')) {
      await db.query('ALTER TABLE reel_comments ADD COLUMN parent_id INT DEFAULT NULL AFTER user_id');
    }
    if (!columnNames.has('voice_url')) {
      await db.query('ALTER TABLE reel_comments ADD COLUMN voice_url VARCHAR(255) DEFAULT NULL');
    }
    if (!columnNames.has('voice_duration_seconds')) {
      await db.query('ALTER TABLE reel_comments ADD COLUMN voice_duration_seconds INT DEFAULT NULL');
    }
  }

  static async getComments(reelId) {
    await Reel.ensureReelCommentsTable();
    const query = `
      SELECT 
        rc.id,
        rc.reel_id,
        rc.user_id,
        rc.parent_id,
        rc.content,
        rc.voice_url,
        rc.voice_duration_seconds,
        rc.created_at,
        u.first_name,
        u.last_name,
        u.avatar,
        u.username,
        u.certification_type
      FROM reel_comments rc
      JOIN users u ON rc.user_id = u.id
      WHERE rc.reel_id = ?
      ORDER BY rc.created_at DESC
    `;
    const [rows] = await db.query(query, [reelId]);
    return rows;
  }

  static async getCommentById(commentId) {
    await Reel.ensureReelCommentsTable();
    const [rows] = await db.query(
      'SELECT id, reel_id, user_id, parent_id FROM reel_comments WHERE id = ? LIMIT 1',
      [commentId]
    );
    return rows[0] || null;
  }

  static async addComment(reelId, userId, content) {
    await Reel.ensureReelCommentsTable();
    const [result] = await db.query(
      'INSERT INTO reel_comments (reel_id, user_id, parent_id, content, voice_url, voice_duration_seconds) VALUES (?, ?, ?, ?, ?, ?)',
      [
        reelId,
        userId,
        content?.parentId || null,
        content?.content !== undefined ? content.content : content,
        content?.voiceUrl || null,
        content?.voiceDurationSeconds !== undefined && content?.voiceDurationSeconds !== null
          ? parseInt(content.voiceDurationSeconds, 10)
          : null
      ]
    );
    await db.query(
      'UPDATE reels SET comments_count = comments_count + 1 WHERE id = ?',
      [reelId]
    );
    return result.insertId;
  }

  static async getSharedAudios() {
    await Reel.ensureReelSchema();
    const [rows] = await db.query('SELECT * FROM reel_shared_audios ORDER BY title ASC');
    return rows;
  }

  static async saveSharedAudio(title, audioUrl) {
    await Reel.ensureReelSchema();
    const [existing] = await db.query('SELECT id FROM reel_shared_audios WHERE audio_url = ?', [audioUrl]);
    if (existing && existing.length > 0) return existing[0].id;
    const [result] = await db.query('INSERT INTO reel_shared_audios (title, audio_url) VALUES (?, ?)', [title, audioUrl]);
    return result.insertId;
  }
}

module.exports = Reel;
