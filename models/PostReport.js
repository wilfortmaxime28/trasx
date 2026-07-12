const db = require('../config/db');

let postReportSchemaPromise = null;

async function ensurePostReportSchema() {
  if (!postReportSchemaPromise) {
    postReportSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS post_reports (
          id INT AUTO_INCREMENT PRIMARY KEY,
          post_id INT NOT NULL,
          reporter_id INT NOT NULL,
          reason VARCHAR(80) NOT NULL,
          details TEXT DEFAULT NULL,
          status ENUM('pending', 'reviewed', 'dismissed', 'actioned') NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_post_reporter (post_id, reporter_id),
          INDEX idx_post_reports_post (post_id),
          INDEX idx_post_reports_reporter (reporter_id),
          INDEX idx_post_reports_status (status)
        )
      `);
    })().catch((error) => {
      postReportSchemaPromise = null;
      throw error;
    });
  }

  return postReportSchemaPromise;
}

class PostReport {
  static async createOrUpdate({ postId, reporterId, reason, details = null }) {
    await ensurePostReportSchema();
    const [result] = await db.query(
      `
        INSERT INTO post_reports (post_id, reporter_id, reason, details)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          reason = VALUES(reason),
          details = VALUES(details),
          status = 'pending',
          updated_at = CURRENT_TIMESTAMP
      `,
      [postId, reporterId, reason, details]
    );

    return result.insertId || 0;
  }

  static async getAllPending() {
    await ensurePostReportSchema();
    const query = `
      SELECT 
        pr.id,
        pr.post_id,
        pr.reporter_id,
        pr.reason,
        pr.details,
        pr.status,
        pr.created_at,
        p.content AS post_content,
        p.image_url AS post_image_url,
        p.media_type AS post_media_type,
        reporter.username AS reporter_username,
        author.id AS author_id,
        author.username AS author_username,
        (
          SELECT COUNT(*) 
          FROM post_reports pr2
          JOIN posts p2 ON pr2.post_id = p2.id
          WHERE p2.user_id = author.id
        ) AS author_report_count
      FROM post_reports pr
      JOIN posts p ON pr.post_id = p.id
      JOIN users reporter ON pr.reporter_id = reporter.id
      JOIN users author ON p.user_id = author.id
      WHERE pr.status = 'pending'
      ORDER BY pr.created_at DESC
    `;
    const [rows] = await db.query(query);
    return rows;
  }

  static async updateStatus(reportId, status) {
    await ensurePostReportSchema();
    const [result] = await db.query(
      'UPDATE post_reports SET status = ? WHERE id = ?',
      [status, reportId]
    );
    return result.affectedRows > 0;
  }

  static async updateStatusByPost(postId, status) {
    await ensurePostReportSchema();
    const [result] = await db.query(
      'UPDATE post_reports SET status = ? WHERE post_id = ? AND status = "pending"',
      [status, postId]
    );
    return result.affectedRows > 0;
  }

  static async updateStatusByUser(authorId, status) {
    await ensurePostReportSchema();
    // Modern MySQL doesn't support direct update on join, but we can do a subquery or a direct standard JOIN UPDATE.
    // Standard JOIN UPDATE:
    const [result] = await db.query(
      `
      UPDATE post_reports pr
      JOIN posts p ON pr.post_id = p.id
      SET pr.status = ?
      WHERE p.user_id = ? AND pr.status = 'pending'
      `,
      [status, authorId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = PostReport;
