const db = require('../config/db');

async function checkDb() {
  try {
    const [tables] = await db.query("SHOW TABLE STATUS FROM weshare2");
    console.log('--- TABLE STATUS ---');
    tables.forEach(t => {
      console.log(`Table: ${t.Name}, Engine: ${t.Engine}, Collation: ${t.Collation}`);
    });
    process.exit(0);
  } catch (error) {
    console.error('Error checking DB:', error);
    process.exit(1);
  }
}

checkDb();
