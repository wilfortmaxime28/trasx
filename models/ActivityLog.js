const db = require('../config/db');

class ActivityLog {
  static async log(userId, actorType, action, targetType = null, targetId = null, metadata = null, req = null) {
    try {
      let ipAddress = null;
      let userAgent = null;

      if (req) {
        ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        userAgent = req.headers['user-agent'];
      }

      const metaString = metadata ? JSON.stringify(metadata) : null;

      await db.query(
        `INSERT INTO activity_logs (user_id, actor_type, action, target_type, target_id, metadata, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, actorType, action, targetType, targetId, metaString, ipAddress, userAgent]
      );
    } catch (err) {
      console.error('Failed to write activity log:', err);
    }
  }

  static async getByUser(userId, limit = 50) {
    const [rows] = await db.query(
      `SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows;
  }

  static async getAll(limit = 100, offset = 0) {
    const [rows] = await db.query(
      `SELECT a.*, u.username, COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name
       FROM activity_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
      [Number(limit) || 100, Number(offset) || 0]
    );
    return rows;
  }

  static async getCount() {
    const [rows] = await db.query('SELECT COUNT(*) AS total FROM activity_logs');
    return rows[0] ? rows[0].total : 0;
  }
}

module.exports = ActivityLog;
