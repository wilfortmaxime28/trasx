const db = require('../config/db');

async function run() {
  try {
    console.log('Altering reels table to support advanced short uploads...');
    
    // Check if video_url can be null
    // Let's modify it to be NULL-able so audio-only and voice shorts can exist without videos
    await db.query("ALTER TABLE reels MODIFY COLUMN video_url VARCHAR(255) NULL");
    console.log('video_url column set to NULL-able successfully.');
    
    // Get column names to avoid duplication errors
    const [cols] = await db.query("SHOW COLUMNS FROM reels");
    const colNames = cols.map(c => c.Field);
    
    if (!colNames.includes('media_type')) {
      await db.query("ALTER TABLE reels ADD COLUMN media_type VARCHAR(20) DEFAULT 'video'");
      console.log('media_type column added.');
    }
    if (!colNames.includes('audio_url')) {
      await db.query("ALTER TABLE reels ADD COLUMN audio_url VARCHAR(255) DEFAULT NULL");
      console.log('audio_url column added.');
    }
    if (!colNames.includes('audio_start_time')) {
      await db.query("ALTER TABLE reels ADD COLUMN audio_start_time DOUBLE DEFAULT 0");
      console.log('audio_start_time column added.');
    }
    if (!colNames.includes('audio_duration')) {
      await db.query("ALTER TABLE reels ADD COLUMN audio_duration INT DEFAULT 30");
      console.log('audio_duration column added.');
    }
    if (!colNames.includes('media_fit')) {
      await db.query("ALTER TABLE reels ADD COLUMN media_fit VARCHAR(20) NOT NULL DEFAULT 'cover'");
      console.log('media_fit column added.');
    }
    if (!colNames.includes('is_trade')) {
      await db.query("ALTER TABLE reels ADD COLUMN is_trade TINYINT(1) DEFAULT 0");
      console.log('is_trade column added.');
    }
    if (!colNames.includes('trade_price')) {
      await db.query("ALTER TABLE reels ADD COLUMN trade_price DECIMAL(10,2) DEFAULT NULL");
      console.log('trade_price column added.');
    }
    if (!colNames.includes('last_possession_user_id')) {
      await db.query("ALTER TABLE reels ADD COLUMN last_possession_user_id INT DEFAULT NULL");
      console.log('last_possession_user_id column added.');
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
    console.log('reel_comments table ensured.');

    const [commentCols] = await db.query("SHOW COLUMNS FROM reel_comments");
    const commentColNames = commentCols.map(c => c.Field);
    if (!commentColNames.includes('parent_id')) {
      await db.query("ALTER TABLE reel_comments ADD COLUMN parent_id INT DEFAULT NULL AFTER user_id");
      console.log('reel_comments.parent_id column added.');
    }
    if (!commentColNames.includes('voice_url')) {
      await db.query("ALTER TABLE reel_comments ADD COLUMN voice_url VARCHAR(255) DEFAULT NULL");
      console.log('reel_comments.voice_url column added.');
    }
    if (!commentColNames.includes('voice_duration_seconds')) {
      await db.query("ALTER TABLE reel_comments ADD COLUMN voice_duration_seconds INT DEFAULT NULL");
      console.log('reel_comments.voice_duration_seconds column added.');
    }
    
    console.log('Database migrated successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();
