const db = require('../config/db');

let statusSchemaPromise = null;

async function ensureStatusTable() {
  if (!statusSchemaPromise) {
    statusSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS statuses (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          media_url VARCHAR(255) NOT NULL,
          media_type VARCHAR(50) NOT NULL,
          media_name VARCHAR(255) DEFAULT NULL,
          media_size INT DEFAULT NULL,
          caption TEXT DEFAULT NULL,
          media_fit VARCHAR(20) DEFAULT 'cover',
          expires_at DATETIME NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          INDEX idx_statuses_user_created (user_id, created_at),
          INDEX idx_statuses_expires_at (expires_at)
        )
      `);

      // Create status_views table
      await db.query(`
        CREATE TABLE IF NOT EXISTS status_views (
          id INT AUTO_INCREMENT PRIMARY KEY,
          status_id INT NOT NULL,
          user_id INT NOT NULL,
          viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY unique_status_user_view (status_id, user_id),
          FOREIGN KEY (status_id) REFERENCES statuses(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Create status_comments table
      await db.query(`
        CREATE TABLE IF NOT EXISTS status_comments (
          id INT AUTO_INCREMENT PRIMARY KEY,
          status_id INT NOT NULL,
          user_id INT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (status_id) REFERENCES statuses(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);

      // Dynamically add new columns to support WhatsApp-like video editing and text/voice statuses
      try {
        await db.query(`ALTER TABLE statuses ADD COLUMN trim_start FLOAT DEFAULT NULL`);
      } catch (e) {}
      try {
        await db.query(`ALTER TABLE statuses ADD COLUMN trim_end FLOAT DEFAULT NULL`);
      } catch (e) {}
      try {
        await db.query(`ALTER TABLE statuses ADD COLUMN bg_color VARCHAR(255) DEFAULT NULL`);
      } catch (e) {}
      try {
        await db.query(`ALTER TABLE statuses ADD COLUMN media_fit VARCHAR(20) DEFAULT 'cover'`);
      } catch (e) {}
    })().catch((error) => {
      statusSchemaPromise = null;
      throw error;
    });
  }

  return statusSchemaPromise;
}

function normalizeStatusRow(row, currentUserId = null) {
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const remainingSeconds = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) : 0;

  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    is_own: currentUserId !== null ? Number(row.user_id) === Number(currentUserId) : false,
    expires_at: expiresAt,
    remaining_seconds: remainingSeconds,
    remaining_text: remainingSeconds >= 60
      ? `${Math.ceil(remainingSeconds / 60)}m`
      : `${remainingSeconds}s`,
    trim_start: row.trim_start !== null && row.trim_start !== undefined ? Number(row.trim_start) : null,
    trim_end: row.trim_end !== null && row.trim_end !== undefined ? Number(row.trim_end) : null,
    bg_color: row.bg_color || null,
    media_fit: row.media_fit === 'contain' ? 'contain' : 'cover'
  };
}

class Status {
  static async purgeExpired() {
    await ensureStatusTable();
    await db.query('DELETE FROM statuses WHERE expires_at <= NOW()');
  }

  static async create(userId, data = {}) {
    await ensureStatusTable();
    const {
      mediaUrl,
      mediaType,
      mediaName = null,
      mediaSize = null,
      caption = null,
      trimStart = null,
      trimEnd = null,
      bgColor = null,
      mediaFit = 'cover'
    } = data;
    const sanitizedMediaFit = mediaFit === 'contain' ? 'contain' : 'cover';

    // Do NOT delete previous active statuses, so users can post multiple updates like WhatsApp.

    const [result] = await db.query(
      `
        INSERT INTO statuses (
          user_id,
          media_url,
          media_type,
          media_name,
          media_size,
          caption,
          media_fit,
          expires_at,
          trim_start,
          trim_end,
          bg_color
        ) VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), ?, ?, ?)
      `,
      [
        userId,
        mediaUrl,
        mediaType,
        mediaName,
        Number.isFinite(Number(mediaSize)) ? Number(mediaSize) : null,
        caption || null,
        sanitizedMediaFit,
        Number.isFinite(parseFloat(trimStart)) ? parseFloat(trimStart) : null,
        Number.isFinite(parseFloat(trimEnd)) ? parseFloat(trimEnd) : null,
        bgColor || null
      ]
    );

    return result.insertId;
  }

  static async getById(id) {
    await ensureStatusTable();
    const [rows] = await db.query(
      `SELECT s.*, COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name, u.username, u.avatar 
       FROM statuses s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.id = ?`,
      [id]
    );
    return rows.length > 0 ? normalizeStatusRow(rows[0]) : null;
  }

  static async getFeedStatuses(userId, limit = 50) {
    await ensureStatusTable();
    await this.purgeExpired();

    const [rows] = await db.query(
      `
        SELECT
          s.id,
          s.user_id,
          s.media_url,
          s.media_type,
          s.media_name,
          s.media_size,
          s.caption,
          s.media_fit,
          s.expires_at,
          s.created_at,
          s.trim_start,
          s.trim_end,
          s.bg_color,
          COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name,
          u.username,
          u.avatar,
          EXISTS(
            SELECT 1 FROM follows f
            WHERE f.follower_id = ? AND f.following_id = s.user_id
          ) AS is_following,
          EXISTS(
            SELECT 1 FROM follows f
            WHERE f.follower_id = s.user_id AND f.following_id = ?
          ) AS is_followed_by
        FROM statuses s
        JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > NOW()
          AND (
            s.user_id = ?
            OR EXISTS(
              SELECT 1
              FROM follows f
              WHERE f.follower_id = ? AND f.following_id = s.user_id
            )
          )
        ORDER BY s.created_at ASC
      `,
      [userId, userId, userId, userId]
    );

    // Group active statuses by user
    const userGroups = {};
    for (const row of rows) {
      const normalized = normalizeStatusRow(row, userId);
      if (!userGroups[normalized.user_id]) {
        userGroups[normalized.user_id] = {
          user_id: normalized.user_id,
          user_name: normalized.user_name,
          username: normalized.username,
          avatar: normalized.avatar,
          is_following: normalized.is_following,
          is_followed_by: normalized.is_followed_by,
          statuses: []
        };
      }
      userGroups[normalized.user_id].statuses.push(normalized);
    }

    // Convert to array and sort: current user's statuses first, then others by newest status
    const groups = Object.values(userGroups);
    groups.sort((a, b) => {
      const aIsOwn = Number(a.user_id) === Number(userId);
      const bIsOwn = Number(b.user_id) === Number(userId);
      if (aIsOwn) return -1;
      if (bIsOwn) return 1;
      const aLatest = Math.max(...a.statuses.map(s => new Date(s.created_at).getTime()));
      const bLatest = Math.max(...b.statuses.map(s => new Date(s.created_at).getTime()));
      return bLatest - aLatest;
    });

    return groups.slice(0, Number(limit) || 12);
  }

  static async recordView(statusId, userId) {
    await ensureStatusTable();
    try {
      await db.query(
        'INSERT IGNORE INTO status_views (status_id, user_id) VALUES (?, ?)',
        [Number(statusId), Number(userId)]
      );
    } catch (e) {
      console.error('Error recording status view:', e);
    }
  }

  static async getViewCount(statusId) {
    await ensureStatusTable();
    const [rows] = await db.query(
      'SELECT COUNT(*) AS count FROM status_views WHERE status_id = ?',
      [Number(statusId)]
    );
    return Number(rows[0]?.count || 0);
  }

  static async getViewers(statusId) {
    await ensureStatusTable();
    const [rows] = await db.query(
      `SELECT sv.user_id, sv.viewed_at,
              COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name,
              u.username, u.avatar
       FROM status_views sv
       JOIN users u ON sv.user_id = u.id
       WHERE sv.status_id = ?
       ORDER BY sv.viewed_at DESC`,
      [Number(statusId)]
    );
    return rows;
  }

  static async addComment(statusId, userId, content) {
    await ensureStatusTable();
    const [result] = await db.query(
      'INSERT INTO status_comments (status_id, user_id, content) VALUES (?, ?, ?)',
      [Number(statusId), Number(userId), content]
    );
    return result.insertId;
  }
}

module.exports = Status;
