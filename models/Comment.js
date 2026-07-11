const db = require('../config/db');

class Comment {
  static async ensureCommentSchema() {
    if (Comment._schemaReady) return;

    const [tableExists] = await db.query("SHOW TABLES LIKE 'comments'");
    if (!tableExists || tableExists.length === 0) {
      console.log('Comments table does not exist yet. Skipping comment schema check.');
      return;
    }

    const [columns] = await db.query('SHOW COLUMNS FROM comments');
    const columnNames = new Set(columns.map((column) => column.Field));

    if (!columnNames.has('parent_id')) {
      await db.query('ALTER TABLE comments ADD COLUMN parent_id INT DEFAULT NULL');
    }
    if (!columnNames.has('voice_url')) {
      await db.query('ALTER TABLE comments ADD COLUMN voice_url VARCHAR(255) DEFAULT NULL');
    }
    if (!columnNames.has('voice_duration_seconds')) {
      await db.query('ALTER TABLE comments ADD COLUMN voice_duration_seconds INT DEFAULT NULL');
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        comment_id INT NOT NULL,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_comment_user (comment_id, user_id),
        FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    Comment._schemaReady = true;
  }

  static async getByPostId(postId) {
    await Comment.ensureCommentSchema();
    const query = `
      SELECT 
        c.id,
        c.post_id,
        c.user_id,
        c.content,
        c.parent_id,
        c.voice_url,
        c.voice_duration_seconds,
        c.created_at,
        u.username AS user_username,
        COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name,
        u.avatar AS user_avatar,
        u.certification_type AS user_certification_type
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `;
    const [rows] = await db.query(query, [postId]);
    return rows;
  }

  static async getByPostIds(postIds = []) {
    await Comment.ensureCommentSchema();
    const numericPostIds = Array.from(
      new Set(
        (Array.isArray(postIds) ? postIds : [])
          .map((postId) => Number.parseInt(postId, 10))
          .filter((postId) => Number.isFinite(postId))
      )
    );

    if (numericPostIds.length === 0) {
      return [];
    }

    const placeholders = numericPostIds.map(() => '?').join(', ');
    const query = `
      SELECT 
        c.id,
        c.post_id,
        c.user_id,
        c.content,
        c.parent_id,
        c.voice_url,
        c.voice_duration_seconds,
        c.created_at,
        u.username AS user_username,
        COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name,
        u.avatar AS user_avatar,
        u.certification_type AS user_certification_type
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id IN (${placeholders})
      ORDER BY c.post_id ASC, c.created_at ASC
    `;
    const [rows] = await db.query(query, numericPostIds);
    return rows;
  }

  static async getById(id) {
    await Comment.ensureCommentSchema();
    const query = `
      SELECT
        c.id,
        c.post_id,
        c.user_id,
        c.content,
        c.parent_id,
        c.voice_url,
        c.voice_duration_seconds,
        c.created_at,
        u.username AS user_username,
        COALESCE(u.display_name, CONCAT(u.first_name, ' ', u.last_name)) AS user_name,
        u.avatar AS user_avatar,
        u.certification_type AS user_certification_type
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
      LIMIT 1
    `;
    const [rows] = await db.query(query, [id]);
    return rows[0] || null;
  }

  static async create(postId, userId, content, parentId = null, voiceUrl = null, voiceDurationSeconds = null) {
    await Comment.ensureCommentSchema();
    const [result] = await db.query(
      'INSERT INTO comments (post_id, user_id, content, parent_id, voice_url, voice_duration_seconds) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, userId, content, parentId, voiceUrl, voiceDurationSeconds]
    );
    return result.insertId;
  }

  static async getAllForAdmin() {
    await Comment.ensureCommentSchema();
    const query = `
      SELECT
        c.id,
        c.post_id,
        c.user_id,
        c.content,
        c.parent_id,
        c.voice_url,
        c.voice_duration_seconds,
        c.created_at,
        commenter.username AS commenter_username,
        commenter.avatar AS commenter_avatar,
        commenter.certification_type AS commenter_certification_type,
        CONCAT(COALESCE(commenter.first_name, ''), ' ', COALESCE(commenter.last_name, '')) AS commenter_name,
        p.user_id AS post_owner_id,
        p.content AS post_content,
        p.image_url AS post_image_url,
        owner.username AS post_owner_username,
        CONCAT(COALESCE(owner.first_name, ''), ' ', COALESCE(owner.last_name, '')) AS post_owner_name
      FROM comments c
      JOIN users commenter ON commenter.id = c.user_id
      JOIN posts p ON p.id = c.post_id
      JOIN users owner ON owner.id = p.user_id
      ORDER BY c.created_at DESC, c.id DESC
    `;
    const [rows] = await db.query(query);
    return rows;
  }

  static async toggleLike(userId, commentId) {
    await Comment.ensureCommentSchema();
    const [existing] = await db.query('SELECT * FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, commentId]);
    let liked = false;
    if (existing.length > 0) {
      await db.query('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?', [userId, commentId]);
    } else {
      await db.query('INSERT INTO comment_likes (user_id, comment_id) VALUES (?, ?)', [userId, commentId]);
      liked = true;
    }
    const [countRow] = await db.query('SELECT COUNT(*) AS count FROM comment_likes WHERE comment_id = ?', [commentId]);
    return { liked, count: countRow[0].count };
  }
}

module.exports = Comment;
