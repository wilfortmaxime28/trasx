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
}

module.exports = PostReport;
