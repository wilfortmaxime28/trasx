const db = require('../config/db');

async function main() {
  try {
    await db.query(`ALTER TABLE comments ADD COLUMN voice_duration_seconds INT DEFAULT NULL`);
    console.log('comments.voice_duration_seconds added');
  } catch (err) {
    if (String(err?.code) === 'ER_DUP_FIELDNAME') {
      console.log('comments.voice_duration_seconds already exists');
      return;
    }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
