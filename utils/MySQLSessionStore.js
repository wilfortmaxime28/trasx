const expressSession = require('express-session');
const db = require('../config/db');

class MySQLSessionStore extends expressSession.Store {
  constructor(options = {}) {
    super();
    this.tableName = options.tableName || 'user_sessions';
    this.defaultTtlMs = Math.max(
      1000,
      Number(options.defaultTtlMs || 0) || (1000 * 60 * 60 * 24 * 365)
    );
    this.cleanupIntervalMs = Math.max(
      60 * 1000,
      Number(options.cleanupIntervalMs || 0) || (1000 * 60 * 60)
    );
    this.ready = this.ensureSchema().catch((error) => {
      console.error('[SessionStore] Schema init error:', error);
      return null;
    });

    this.cleanupTimer = setInterval(() => {
      this.clearExpiredSessions().catch((error) => {
        console.error('[SessionStore] Cleanup error:', error);
      });
    }, this.cleanupIntervalMs);

    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  async ensureSchema() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
        session_id VARCHAR(191) NOT NULL PRIMARY KEY,
        session_data LONGTEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_${this.tableName}_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  resolveExpiresAt(sessionData) {
    const cookie = sessionData?.cookie || {};

    if (cookie.expires) {
      const explicitDate = new Date(cookie.expires);
      if (!Number.isNaN(explicitDate.getTime())) {
        return explicitDate;
      }
    }

    if (Number.isFinite(Number(cookie.maxAge)) && Number(cookie.maxAge) > 0) {
      return new Date(Date.now() + Number(cookie.maxAge));
    }

    return new Date(Date.now() + this.defaultTtlMs);
  }

  async clearExpiredSessions() {
    await this.ready;
    await db.query(
      `DELETE FROM \`${this.tableName}\` WHERE expires_at <= UTC_TIMESTAMP()`
    );
  }

  get(sessionId, callback) {
    this.ready
      .then(async () => {
        const [rows] = await db.query(
          `SELECT session_data
           FROM \`${this.tableName}\`
           WHERE session_id = ? AND expires_at > UTC_TIMESTAMP()
           LIMIT 1`,
          [sessionId]
        );

        if (!rows.length) {
          callback(null, null);
          return;
        }

        let parsedData = null;
        try {
          parsedData = JSON.parse(rows[0].session_data);
        } catch (error) {
          await this.destroy(sessionId, () => {});
          callback(error);
          return;
        }

        callback(null, parsedData);
      })
      .catch((error) => callback(error));
  }

  set(sessionId, sessionData, callback = () => {}) {
    this.ready
      .then(async () => {
        const expiresAt = this.resolveExpiresAt(sessionData);
        const serializedSession = JSON.stringify(sessionData);

        await db.query(
          `INSERT INTO \`${this.tableName}\` (session_id, session_data, expires_at)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE
             session_data = VALUES(session_data),
             expires_at = VALUES(expires_at),
             updated_at = CURRENT_TIMESTAMP`,
          [sessionId, serializedSession, expiresAt]
        );

        callback(null);
      })
      .catch((error) => callback(error));
  }

  touch(sessionId, sessionData, callback = () => {}) {
    this.ready
      .then(async () => {
        const expiresAt = this.resolveExpiresAt(sessionData);
        const serializedSession = JSON.stringify(sessionData);

        await db.query(
          `UPDATE \`${this.tableName}\`
           SET expires_at = ?, session_data = ?, updated_at = CURRENT_TIMESTAMP
           WHERE session_id = ?`,
          [expiresAt, serializedSession, sessionId]
        );

        callback(null);
      })
      .catch((error) => callback(error));
  }

  destroy(sessionId, callback = () => {}) {
    this.ready
      .then(async () => {
        await db.query(
          `DELETE FROM \`${this.tableName}\` WHERE session_id = ?`,
          [sessionId]
        );
        callback(null);
      })
      .catch((error) => callback(error));
  }
}

module.exports = MySQLSessionStore;
