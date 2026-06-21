const db = require('../config/db');

async function check() {
  try {
    const [postsCols] = await db.query('SHOW COLUMNS FROM posts');
    console.log('--- POSTS COLUMNS ---');
    console.log(postsCols.map(c => `${c.Field} (${c.Type})`));

    const [reelsCols] = await db.query('SHOW COLUMNS FROM reels');
    console.log('--- REELS COLUMNS ---');
    console.log(reelsCols.map(c => `${c.Field} (${c.Type})`));
  } catch (err) {
    console.error(err);
  } finally {
    db.end();
  }
}

check();
