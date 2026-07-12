const db = require('../config/db');

async function run() {
  try {
    const [rows] = await db.query('SELECT id, user_id, video_url, media_type, audio_url FROM reels');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Error fetching reels:', error);
    process.exit(1);
  }
}

run();
