const db = require('../config/db');

(async () => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = 18');
    console.log('User ID 18:', rows[0]);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
