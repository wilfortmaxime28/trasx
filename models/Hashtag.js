const db = require('../config/db');

class Hashtag {
  static async create(name, creatorId, isPaid, price) {
    const [result] = await db.execute(
      'INSERT INTO hashtags (name, creator_id, is_paid, price) VALUES (?, ?, ?, ?)',
      [name, creatorId, isPaid, price]
    );
    return result.insertId;
  }

  static async getAll() {
    const [rows] = await db.execute(`
      SELECT
        h.*,
        u.first_name,
        u.last_name,
        u.avatar,
        (
          SELECT COUNT(*)
          FROM posts p
          WHERE LOWER(COALESCE(p.content, '')) REGEXP CONCAT('(^|[^a-z0-9_])#', LOWER(h.name), '([^a-z0-9_]|$)')
        ) AS usage_count
      FROM hashtags h 
      JOIN users u ON h.creator_id = u.id 
      ORDER BY usage_count DESC, h.created_at DESC
    `);
    return rows;
  }

  static async getByName(name) {
    const [rows] = await db.execute('SELECT * FROM hashtags WHERE name = ?', [name]);
    return rows[0];
  }

  static async getDetailsByName(name) {
    const [rows] = await db.execute(`
      SELECT 
        h.*,
        u.first_name,
        u.last_name,
        u.username,
        u.avatar,
        (
          SELECT COUNT(*)
          FROM posts p
          WHERE LOWER(COALESCE(p.content, '')) REGEXP CONCAT('(^|[^a-z0-9_])#', LOWER(h.name), '([^a-z0-9_]|$)')
        ) AS usage_count
      FROM hashtags h
      JOIN users u ON h.creator_id = u.id
      WHERE h.name = ?
    `, [name]);
    return rows[0] || null;
  }
}

module.exports = Hashtag;
