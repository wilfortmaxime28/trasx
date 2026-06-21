const db = require('../config/db');

async function main() {
  try {
    const [rows] = await db.query('SELECT id, username, email FROM users');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
