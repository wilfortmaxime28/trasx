const db = require('../config/db');

async function run() {
  try {
    console.log('Altering notifications table type enum to include game...');
    await db.query("ALTER TABLE notifications MODIFY COLUMN type ENUM('like', 'comment', 'share', 'follow', 'mention', 'message', 'ad-published', 'game') NOT NULL");
    console.log('Altered notifications type successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Error migrating DB:', error);
    process.exit(1);
  }
}

run();
